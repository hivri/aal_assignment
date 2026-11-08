from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, ConfigDict, Field


LeadStatus = Literal["new", "qualified", "proposal_sent", "won", "lost"]
LeadSource = Literal["website", "referral", "linkedin", "other"]


class LeadCreate(BaseModel):
    name: str
    email: EmailStr
    company: str
    budget: float = Field(gt=0)
    source: LeadSource = "website"
    requirements: str | None = None


class LeadResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    company: str
    budget: float
    status: LeadStatus
    source: LeadSource
    created_at: datetime
    requirements: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    token_type: str


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str | None
    status: str
    lead_id: int
    created_by: int
    created_at: datetime
    assigned_to: int | None

    model_config = ConfigDict(from_attributes=True)


class ProjectAssign(BaseModel):
    assigned_to: int


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    project_id: int


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str | None
    status: str
    project_id: int
    assigned_to: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskAssign(BaseModel):
    assigned_to: int


class TaskStatusUpdate(BaseModel):
    status: Literal["todo", "in_progress", "completed"]


class LeadQualificationResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    decision: Literal["qualified", "needs_review", "not_qualified"]
    reasoning: str
    next_action: str


class ProposalGenerate(BaseModel):
    lead_id: int


class ProposalResponse(BaseModel):
    id: int
    title: str
    executive_summary: str
    scope: str
    deliverables: list[str]
    timeline: str
    estimated_budget: float
    status: Literal["draft", "approved", "rejected"]
    lead_id: int
    created_by: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProposalContent(BaseModel):
    title: str
    executive_summary: str
    scope: str
    deliverables: list[str]
    timeline: str
    estimated_budget: float = Field(gt=0)


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr | None = None
    phone: str | None = None
    company: str | None = None
    lead_id: int | None = None


class ContactResponse(BaseModel):
    id: int
    name: str
    email: str | None
    phone: str | None
    company: str | None
    lead_id: int | None
    owner_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
