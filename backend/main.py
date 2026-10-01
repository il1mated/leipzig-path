import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field

BASE = Path(__file__).resolve().parent
DB = BASE / "leipzig_path.db"
SECRET_KEY = os.getenv("LEIPZIG_SECRET", "CHANGE_ME_IN_PRODUCTION")
ALGORITHM = "HS256"
TOKEN_MINUTES = 60 * 24 * 7

pwd = PasswordHash.recommended()
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

app = FastAPI(title="Leipzig Path API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, replace with your frontend domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    with conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS progress (
            user_id INTEGER NOT NULL,
            item_id TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(user_id, item_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS profile (
            user_id INTEGER PRIMARY KEY,
            german_level TEXT NOT NULL DEFAULT 'A0',
            english_level TEXT NOT NULL DEFAULT 'A1',
            target_program TEXT NOT NULL DEFAULT 'Informatik',
            target_city TEXT NOT NULL DEFAULT 'Leipzig',
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )""")

@app.on_event("startup")
def startup():
    init_db()

def make_token(user_id: int):
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=TOKEN_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def current_user(token: str = Depends(oauth2)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    with conn() as c:
        user = c.execute("SELECT id,email FROM users WHERE id=?", (uid,)).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

class AuthIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

class ProgressIn(BaseModel):
    item_id: str
    done: bool

class ProfileIn(BaseModel):
    german_level: str = "A0"
    english_level: str = "A1"
    target_program: str = "Informatik"
    target_city: str = "Leipzig"

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/auth/register")
def register(data: AuthIn):
    email = data.email.lower()
    with conn() as c:
        if c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="Email already registered")
        cur = c.execute(
            "INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)",
            (email, pwd.hash(data.password), datetime.now(timezone.utc).isoformat())
        )
        uid = cur.lastrowid
        c.execute("INSERT INTO profile(user_id) VALUES(?)", (uid,))
    return {"access_token": make_token(uid), "token_type": "bearer"}

@app.post("/api/auth/login")
def login(data: AuthIn):
    email = data.email.lower()
    with conn() as c:
        user = c.execute("SELECT id,password_hash FROM users WHERE email=?", (email,)).fetchone()
    if not user or not pwd.verify(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return {"access_token": make_token(user["id"]), "token_type": "bearer"}

@app.get("/api/me")
def me(user=Depends(current_user)):
    with conn() as c:
        p = c.execute("SELECT * FROM profile WHERE user_id=?", (user["id"],)).fetchone()
        rows = c.execute(
            "SELECT item_id,done FROM progress WHERE user_id=?", (user["id"],)
        ).fetchall()
    return {
        "id": user["id"],
        "email": user["email"],
        "profile": dict(p) if p else {},
        "progress": {r["item_id"]: bool(r["done"]) for r in rows},
    }

@app.put("/api/progress")
def set_progress(data: ProgressIn, user=Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    with conn() as c:
        c.execute("""INSERT INTO progress(user_id,item_id,done,updated_at)
                     VALUES(?,?,?,?)
                     ON CONFLICT(user_id,item_id) DO UPDATE SET
                     done=excluded.done, updated_at=excluded.updated_at""",
                  (user["id"], data.item_id, int(data.done), now))
    return {"ok": True}

@app.put("/api/profile")
def set_profile(data: ProfileIn, user=Depends(current_user)):
    with conn() as c:
        c.execute("""INSERT INTO profile(user_id,german_level,english_level,target_program,target_city)
                     VALUES(?,?,?,?,?)
                     ON CONFLICT(user_id) DO UPDATE SET
                     german_level=excluded.german_level,
                     english_level=excluded.english_level,
                     target_program=excluded.target_program,
                     target_city=excluded.target_city""",
                  (user["id"], data.german_level, data.english_level,
                   data.target_program, data.target_city))
    return {"ok": True}
