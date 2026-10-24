from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..households import create_personal_household, ensure_household
from ..models import UserRow
from ..localization import valid_language
from ..schemas import LoginRequest, ProfileUpdateIn, RegisterRequest, TokenResponse, UserOut
from ..security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_out(user: UserRow) -> UserOut:
    return UserOut(id=user.id, username=user.username, name=user.name, isAdmin=user.is_admin, language=valid_language(user.language))


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(UserRow).filter(UserRow.username == body.username.lower()).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    user = UserRow(
        username=body.username.lower(),
        name=body.name,
        hashed_password=hash_password(body.password),
        language=body.language,
    )
    db.add(user)
    db.flush()
    # Every account starts in its own household ("Samir's kitchen"); joining another one
    # later moves it (see households.join_household).
    create_personal_household(db, user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=_user_out(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    user = db.query(UserRow).filter(UserRow.username == body.username.lower()).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise invalid

    ensure_household(db, user)
    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=_user_out(user),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: UserRow = Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_household(db, current_user)
    return _user_out(current_user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdateIn, current_user: UserRow = Depends(get_current_user), db: Session = Depends(get_db)):
    """The account's own preferences: language (en/fr/ar), display name."""
    if body.language is not None:
        current_user.language = body.language
    if body.name is not None:
        current_user.name = body.name.strip() or current_user.name
    db.commit()
    db.refresh(current_user)
    return _user_out(current_user)
