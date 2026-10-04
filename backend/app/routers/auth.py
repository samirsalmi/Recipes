from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import UserRow
from ..schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut
from ..security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(UserRow).filter(UserRow.username == body.username.lower()).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    user = UserRow(
        username=body.username.lower(),
        name=body.name,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user.id, username=user.username, name=user.name, isAdmin=user.is_admin),
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    user = db.query(UserRow).filter(UserRow.username == body.username.lower()).first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise invalid

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user.id, username=user.username, name=user.name, isAdmin=user.is_admin),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: UserRow = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        username=current_user.username,
        name=current_user.name,
        isAdmin=current_user.is_admin,
    )
