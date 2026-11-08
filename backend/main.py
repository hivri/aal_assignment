import os
from pydantic import ValidationError
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from schemas import TaskCreate, TaskResponse, TaskAssign, TaskStatusUpdate
import models
from db import engine, Base, get_db
from schemas import LeadCreate, LeadResponse, LeadStatus
from auth import hash_password, verify_password, create_access_token
from schemas import (
    UserCreate,
    UserLogin,
    UserResponse,
    Token,
    ProjectResponse,
    ProjectAssign,
    LeadQualificationResponse,
)
from auth import get_current_user, require_role
from fastapi.middleware.cors import CORSMiddleware
from groq import APIError
from ai_service import qualify_lead, generate_proposal
from schemas import ProposalGenerate, ProposalResponse, ProposalContent
import logging
from schemas import ContactCreate, ContactResponse

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)
app = FastAPI(title="LeadFlow API")
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["http://localhost:5173"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "LeadFlow API is running"}


@app.post("/leads", response_model=LeadResponse, status_code=201)
def create_lead(
    lead: LeadCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    new_lead = models.Lead(**lead.model_dump(), owner_id=current_user.id)

    db.add(new_lead)
    db.commit()
    db.refresh(new_lead)

    return new_lead


@app.get("/leads", response_model=list[LeadResponse])
def get_leads(
    status: LeadStatus | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    query = db.query(models.Lead)

    # Sales reps can only see their own leads.
    if current_user.role == "sales_rep":
        query = query.filter(models.Lead.owner_id == current_user.id)

    if status:
        query = query.filter(models.Lead.status == status)

    return query.order_by(models.Lead.created_at.desc()).all()


@app.patch("/leads/{lead_id}/status", response_model=LeadResponse)
def update_lead_status(
    lead_id: int,
    status: LeadStatus,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    query = db.query(models.Lead).filter(models.Lead.id == lead_id)

    if current_user.role == "sales_rep":
        query = query.filter(models.Lead.owner_id == current_user.id)

    lead = query.first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead.status = status

    if status == "won":
        existing_project = (
            db.query(models.Project).filter(models.Project.lead_id == lead.id).first()
        )

        if not existing_project:
            project = models.Project(
                name=f"{lead.company} - {lead.name}",
                description=f"Project created from lead #{lead.id}",
                lead_id=lead.id,
                created_by=current_user.id,
            )
            db.add(project)

    db.commit()
    db.refresh(lead)

    return lead


@app.post("/auth/register", response_model=UserResponse, status_code=201)
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    existing_user = (
        db.query(models.User).filter(models.User.email == user.email).first()
    )

    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    new_user = models.User(
        name=user.name,
        email=user.email,
        hashed_password=hash_password(user.password),
        role="sales_rep",
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@app.post("/auth/login", response_model=Token)
def login_user(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == credentials.email).first()

    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = create_access_token(user.id)

    return {"access_token": token, "token_type": "bearer"}


@app.get("/auth/me", response_model=UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@app.get("/projects", response_model=list[ProjectResponse])
def get_projects(
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep", "delivery_member")),
):
    query = db.query(models.Project)

    if current_user.role == "sales_rep":
        query = query.join(
            models.Lead, models.Project.lead_id == models.Lead.id
        ).filter(models.Lead.owner_id == current_user.id)

    elif current_user.role == "delivery_member":
        query = query.filter(models.Project.assigned_to == current_user.id)

    return query.order_by(models.Project.created_at.desc()).all()


@app.patch("/projects/{project_id}/assign", response_model=ProjectResponse)
def assign_project(
    project_id: int,
    assignment: ProjectAssign,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Sales reps can only assign projects created from their own leads.
    if current_user.role == "sales_rep":
        lead = (
            db.query(models.Lead)
            .filter(
                models.Lead.id == project.lead_id,
                models.Lead.owner_id == current_user.id,
            )
            .first()
        )

        if not lead:
            raise HTTPException(status_code=404, detail="Project not found")

    # Check that the target user exists and is a delivery member.
    delivery_member = (
        db.query(models.User)
        .filter(
            models.User.id == assignment.assigned_to,
            models.User.role == "delivery_member",
            models.User.is_active == True,
        )
        .first()
    )

    if not delivery_member:
        raise HTTPException(
            status_code=400, detail="User must be an active delivery member"
        )

    project.assigned_to = delivery_member.id

    db.commit()
    db.refresh(project)

    return project


@app.post("/tasks", response_model=TaskResponse, status_code=201)
def create_task(
    task: TaskCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    project = (
        db.query(models.Project).filter(models.Project.id == task.project_id).first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if current_user.role == "sales_rep":
        lead = (
            db.query(models.Lead)
            .filter(
                models.Lead.id == project.lead_id,
                models.Lead.owner_id == current_user.id,
            )
            .first()
        )

        if not lead:
            raise HTTPException(status_code=404, detail="Project not found")

    new_task = models.Task(
        title=task.title, description=task.description, project_id=task.project_id
    )

    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    return new_task


@app.get("/tasks", response_model=list[TaskResponse])
def get_tasks(
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep", "delivery_member")),
):
    query = db.query(models.Task)

    if current_user.role == "sales_rep":
        query = (
            query.join(models.Project, models.Task.project_id == models.Project.id)
            .join(models.Lead, models.Project.lead_id == models.Lead.id)
            .filter(models.Lead.owner_id == current_user.id)
        )

    elif current_user.role == "delivery_member":
        query = query.filter(models.Task.assigned_to == current_user.id)

    return query.order_by(models.Task.created_at.desc()).all()


@app.patch("/tasks/{task_id}/assign", response_model=TaskResponse)
def assign_task(
    task_id: int,
    assignment: TaskAssign,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.role == "sales_rep":
        lead = (
            db.query(models.Lead)
            .join(models.Project, models.Project.lead_id == models.Lead.id)
            .filter(
                models.Project.id == task.project_id,
                models.Lead.owner_id == current_user.id,
            )
            .first()
        )

        if not lead:
            raise HTTPException(status_code=404, detail="Task not found")

    delivery_member = (
        db.query(models.User)
        .filter(
            models.User.id == assignment.assigned_to,
            models.User.role == "delivery_member",
            models.User.is_active == True,
        )
        .first()
    )

    if not delivery_member:
        raise HTTPException(
            status_code=400, detail="User must be an active delivery member"
        )

    task.assigned_to = delivery_member.id

    db.commit()
    db.refresh(task)

    return task


@app.patch("/tasks/{task_id}/status", response_model=TaskResponse)
def update_task_status(
    task_id: int,
    update: TaskStatusUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "delivery_member")),
):
    query = db.query(models.Task).filter(models.Task.id == task_id)

    if current_user.role == "delivery_member":
        query = query.filter(models.Task.assigned_to == current_user.id)

    task = query.first()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = update.status

    db.commit()
    db.refresh(task)

    return task


@app.post(
    "/ai/leads/{lead_id}/qualify",
    response_model=LeadQualificationResponse,
)
def ai_qualify_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "sales_rep")),
):
    query = db.query(models.Lead).filter(models.Lead.id == lead_id)

    # Sales reps may only qualify their own leads.
    if current_user.role == "sales_rep":
        query = query.filter(models.Lead.owner_id == current_user.id)

    lead = query.first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead_data = {
        "name": lead.name,
        "company": lead.company,
        "budget": lead.budget,
        "source": lead.source,
        "status": lead.status,
    }

    try:
        ai_result = qualify_lead(lead_data)
        return LeadQualificationResponse.model_validate(ai_result)

    except (APIError, TimeoutError):
        db.rollback()
        logger.exception("Groq proposal generation failed")
        raise HTTPException(
            status_code=502,
            detail="AI provider is temporarily unavailable. Check backend logs",
        )

    except (ValueError, ValidationError):
        raise HTTPException(
            status_code=502,
            detail="AI returned an invalid response. Please try again.",
        )


@app.post("/ai/proposals/generate", response_model=ProposalResponse, status_code=201)
def create_proposal(
    request: ProposalGenerate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin", "sales_rep")),
):
    lead = db.query(models.Lead).filter(models.Lead.id == request.lead_id).first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if current_user.role == "sales_rep" and lead.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Lead not found")

    if not lead.requirements or len(lead.requirements.strip()) < 20:
        raise HTTPException(
            status_code=422,
            detail="Add at least 20 characters of customer requirements to this lead first.",
        )

    lead_data = {
        "name": lead.name,
        "company": lead.company,
        "budget": lead.budget,
        "source": lead.source,
        "status": lead.status,
    }

    try:
        ai_result = generate_proposal(lead_data, lead.requirements)
        proposal_data = ProposalContent.model_validate(ai_result)

        proposal = models.Proposal(
            **proposal_data.model_dump(),
            lead_id=lead.id,
            created_by=current_user.id,
        )

        db.add(proposal)
        db.commit()
        db.refresh(proposal)
        return proposal

    except (APIError, TimeoutError):
        db.rollback()
        logger.exception("Groq proposal generation failed")
        raise HTTPException(status_code=502, detail="AI proposal generation failed")

    except (ValueError, ValidationError):
        db.rollback()
        logger.exception("Proposal validation failed")
        raise HTTPException(status_code=502, detail="AI returned invalid proposal data")


@app.get("/proposals", response_model=list[ProposalResponse])
def get_proposals(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin", "sales_rep")),
):
    query = db.query(models.Proposal)

    if current_user.role == "sales_rep":
        query = query.join(
            models.Lead, models.Proposal.lead_id == models.Lead.id
        ).filter(models.Lead.owner_id == current_user.id)

    return query.order_by(models.Proposal.created_at.desc()).all()


@app.post("/contacts", response_model=ContactResponse, status_code=201)
def create_contact(
    request: ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin", "sales_rep")),
):
    if request.lead_id is not None:
        lead = db.query(models.Lead).filter(models.Lead.id == request.lead_id).first()

        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")

        if current_user.role == "sales_rep" and lead.owner_id != current_user.id:
            raise HTTPException(status_code=404, detail="Lead not found")

    contact = models.Contact(
        **request.model_dump(),
        owner_id=current_user.id,
    )

    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@app.get("/contacts", response_model=list[ContactResponse])
def get_contacts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin", "sales_rep")),
):
    query = db.query(models.Contact)

    if current_user.role == "sales_rep":
        query = query.filter(models.Contact.owner_id == current_user.id)

    return query.order_by(models.Contact.created_at.desc()).all()


@app.get("/users", response_model=list[UserResponse])
def get_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin")),
):
    return db.query(models.User).order_by(models.User.id).all()


@app.patch("/users/{user_id}/status", response_model=UserResponse)
def update_user_status(
    user_id: int,
    is_active: bool,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin")),
):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    if target_user.id == current_user.id and not is_active:
        raise HTTPException(
            status_code=400, detail="You cannot deactivate your own account"
        )

    target_user.is_active = is_active
    db.commit()
    db.refresh(target_user)

    return target_user
