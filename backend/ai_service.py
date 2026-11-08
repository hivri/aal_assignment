import json
import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

# Load the project-root .env file.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

api_key = os.getenv("GROQ_API_KEY")
if not api_key:
    raise RuntimeError("GROQ_API_KEY is missing from the project .env file")

MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

client = Groq(
    api_key=api_key,
    timeout=30.0,
    max_retries=1,
)


def qualify_lead(lead_data: dict) -> dict:
    """Ask the LLM to assess a lead and return structured JSON."""

    prompt = f"""
You are a sales lead qualification assistant.

Evaluate this lead using only the information provided.
Do not invent missing information.

Lead:
{json.dumps(lead_data, ensure_ascii=False)}

Return ONLY a JSON object with these fields:
- score: integer from 0 to 100
- decision: one of "qualified", "needs_review", "not_qualified"
- reasoning: short explanation
- next_action: one practical recommended action

Scoring guidance:
- Consider budget, company, contact information and available context.
- A high budget alone does not guarantee qualification.
- If information is insufficient, use needs_review.
"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": "You assess sales leads and return valid JSON only.",
            },
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=400,
    )

    content = response.choices[0].message.content

    if not content:
        raise ValueError("The AI returned an empty response")

    return json.loads(content)


def generate_proposal(lead_data: dict, requirements: str) -> dict:
    """Generate a proposal with schema-constrained JSON output."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": f"""
Create a professional business proposal.

Lead information:
{json.dumps(lead_data, ensure_ascii=False)}

Customer requirements:
{requirements}

Create a realistic proposal. Do not invent requirements.
Use the lead budget as a reference, not a guaranteed price.
If information is missing, state reasonable assumptions.
""",
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "business_proposal",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "executive_summary": {"type": "string"},
                        "scope": {"type": "string"},
                        "deliverables": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "timeline": {"type": "string"},
                        "estimated_budget": {"type": "number"},
                    },
                    "required": [
                        "title",
                        "executive_summary",
                        "scope",
                        "deliverables",
                        "timeline",
                        "estimated_budget",
                    ],
                    "additionalProperties": False,
                },
            },
        },
        max_completion_tokens=1500,
    )

    content = response.choices[0].message.content

    if not content:
        raise ValueError("The AI returned an empty proposal")

    return json.loads(content)
