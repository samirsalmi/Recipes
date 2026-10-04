from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AppStorageRow, UserRow
from ..schemas import StorageValue
from ..security import get_current_user

router = APIRouter(prefix="/api/storage", tags=["storage"])


@router.get("/{key}")
def get_value(
    key: str, db: Session = Depends(get_db), current_user: UserRow = Depends(get_current_user)
):
    row = db.get(AppStorageRow, (current_user.id, key))
    return {"value": row.value if row else None}


@router.put("/{key}")
def set_value(
    key: str,
    body: StorageValue,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
):
    row = db.get(AppStorageRow, (current_user.id, key))
    if row is None:
        row = AppStorageRow(user_id=current_user.id, key=key, value=body.value)
        db.add(row)
    else:
        row.value = body.value
    db.commit()
    return {"success": True}


@router.delete("/{key}")
def delete_value(
    key: str, db: Session = Depends(get_db), current_user: UserRow = Depends(get_current_user)
):
    row = db.get(AppStorageRow, (current_user.id, key))
    if row is not None:
        db.delete(row)
        db.commit()
    return {"success": True}
