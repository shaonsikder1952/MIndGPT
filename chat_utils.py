from datetime import datetime
from models import ChatSession, ChatMessage
from your_flask_app import db

def create_new_chat_session(user, title="New Chat Session"):
    session = ChatSession(user=user, title=title)
    db.session.add(session)
    db.session.commit()
    return session

def add_message_to_session(session, role, content):
    message = ChatMessage(session=session, role=role, content=content, timestamp=datetime.utcnow())
    db.session.add(message)
    session.last_updated = datetime.utcnow()
    db.session.commit()
    return message
