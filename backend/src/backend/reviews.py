"""Human review of AI drafts: read, edit, approve, reject. Every change is audited."""

from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, col, select

from backend.models import (
    Accomplishment,
    AuditLog,
    Commit,
    SummaryBatch,
    SummaryStatus,
    commit_to_dict,
    iso,
    utcnow,
)

MAX_TEXT_CHARS = 600
MAX_ITEMS = 30


class ReviewError(Exception):
    """Invalid review action; the message is shown to the reviewer."""


class NotFound(ReviewError):
    pass


@dataclass
class ItemEdit:
    text: str
    commit_ids: list[int]
    #: The accomplishment being edited, if it already existed (keeps the AI's original wording).
    id: int | None = None


def _items(s: Session, batch_id: int) -> list[Accomplishment]:
    return list(s.exec(select(Accomplishment).where(Accomplishment.batch_id == batch_id).order_by(col(Accomplishment.position))).all())


def _snapshot(items: list[Accomplishment]) -> dict[str, Any]:
    return {"items": [{"text": a.text, "commitIds": a.commit_ids} for a in items]}


def batch_to_dict(s: Session, batch: SummaryBatch) -> dict[str, Any]:
    assert batch.id is not None
    items = _items(s, batch.id)
    commit_ids = set(batch.source_commit_ids) | {cid for a in items for cid in a.commit_ids}
    commits = s.exec(select(Commit).where(col(Commit.id).in_(commit_ids)).order_by(col(Commit.committed_at))).all() if commit_ids else []
    return {
        "id": batch.id,
        "date": batch.work_date.isoformat(),
        "status": batch.status,
        "model": batch.model,
        "createdAt": iso(batch.created_at),
        "reviewedAt": iso(batch.reviewed_at),
        "reviewNote": batch.review_note,
        "items": [
            {"id": a.id, "text": a.text, "commitIds": a.commit_ids, "edited": a.original_text is not None and a.original_text != a.text}
            for a in items
        ],
        "sourceCommitIds": batch.source_commit_ids,
        "commits": [commit_to_dict(c) for c in commits],
    }


def get_batch(s: Session, batch_id: int) -> SummaryBatch:
    batch = s.get(SummaryBatch, batch_id)
    if batch is None:
        raise NotFound("summary not found")
    return batch


def _require_pending(batch: SummaryBatch) -> None:
    if batch.status != SummaryStatus.PENDING_REVIEW:
        raise ReviewError(f"this summary is already {batch.status.replace('_', ' ')}")


def edit_items(s: Session, batch_id: int, edits: list[ItemEdit]) -> SummaryBatch:
    batch = get_batch(s, batch_id)
    _require_pending(batch)
    if not edits:
        raise ReviewError("keep at least one accomplishment (or reject the summary)")
    if len(edits) > MAX_ITEMS:
        raise ReviewError(f"at most {MAX_ITEMS} accomplishments")

    allowed = set(batch.source_commit_ids)
    cleaned: list[ItemEdit] = []
    for n, e in enumerate(edits, 1):
        text = " ".join(e.text.split())
        if not text:
            raise ReviewError(f"accomplishment {n} is empty")
        if len(text) > MAX_TEXT_CHARS:
            raise ReviewError(f"accomplishment {n} is longer than {MAX_TEXT_CHARS} characters")
        ids = list(dict.fromkeys(e.commit_ids))
        if not ids:
            raise ReviewError(f"accomplishment {n} must cite at least one commit")
        if not set(ids) <= allowed:
            raise ReviewError(f"accomplishment {n} cites a commit that isn't part of this day")
        cleaned.append(ItemEdit(text, ids, e.id))

    old = _items(s, batch_id)
    before = _snapshot(old)
    originals = {a.id: (a.original_text or a.text) for a in old}
    for a in old:
        s.delete(a)
    s.flush()
    new = [
        Accomplishment(batch_id=batch_id, position=i, text=e.text, commit_ids=e.commit_ids, original_text=originals.get(e.id))
        for i, e in enumerate(cleaned)
    ]
    for a in new:
        s.add(a)
    s.add(AuditLog(entity="summary_batch", entity_id=batch_id, action="edited", before=before, after=_snapshot(new)))
    s.commit()
    s.refresh(batch)
    return batch


def _decide(s: Session, batch_id: int, status: SummaryStatus, action: str, note: str | None) -> SummaryBatch:
    batch = get_batch(s, batch_id)
    _require_pending(batch)
    note = (note or "").strip()[:500] or None
    snapshot = _snapshot(_items(s, batch_id))
    batch.status, batch.reviewed_at, batch.review_note = status, utcnow(), note
    s.add(batch)
    s.add(AuditLog(entity="summary_batch", entity_id=batch_id, action=action, before=snapshot, after=snapshot, note=note))
    s.commit()
    s.refresh(batch)
    return batch


def approve(s: Session, batch_id: int, note: str | None = None) -> SummaryBatch:
    return _decide(s, batch_id, SummaryStatus.APPROVED, "approved", note)


def reject(s: Session, batch_id: int, note: str | None = None) -> SummaryBatch:
    return _decide(s, batch_id, SummaryStatus.REJECTED, "rejected", note)


def audit_trail(s: Session, batch_id: int) -> list[dict[str, Any]]:
    rows = s.exec(
        select(AuditLog).where(AuditLog.entity == "summary_batch", AuditLog.entity_id == batch_id).order_by(col(AuditLog.id))
    ).all()
    return [{"action": r.action, "before": r.before, "after": r.after, "note": r.note, "at": iso(r.at)} for r in rows]
