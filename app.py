from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_session import Session
from flask_login import LoginManager, login_user, logout_user, login_required, UserMixin, current_user
from authlib.integrations.flask_client import OAuth
from extensions import db, bcrypt  # ✅ imported correctly
from datetime import datetime
import requests

# OAuth Key
import os
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
print("🧪 DEBUG: Loaded OPENROUTER_API_KEY =", OPENROUTER_API_KEY)


app = Flask(__name__)
app.secret_key = 'your-secret-key'

# App Config
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# Initialize extensions
Session(app)
db.init_app(app)
bcrypt.init_app(app)

# Flask-Login Setup
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Google OAuth Setup
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id='588239789126-8ao3vl9jo9nluvjjmjcjf6elmh2ao95m.apps.googleusercontent.com',
    client_secret='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',
    access_token_url='https://oauth2.googleapis.com/token',
    authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
    api_base_url='https://openidconnect.googleapis.com/v1/',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
    client_kwargs={'scope': 'openid email profile'}
)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Import custom models
from models import User, ChatSession, ChatMessage

# Create tables
with app.app_context():
    db.create_all()

# Routes
@app.route('/')
@login_required
def home():
    sessions = ChatSession.query.filter_by(user_id=current_user.id).order_by(ChatSession.last_updated.desc()).all()
    return render_template('chat.html', username=current_user.email, sessions=sessions)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        user = User.query.filter_by(email=email).first()
        if user and user.password and bcrypt.check_password_hash(user.password, password):
            login_user(user)
            return redirect(url_for('home'))
        return 'Invalid credentials'
    return render_template('login.html')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        email = request.form['email']
        password = bcrypt.generate_password_hash(request.form['password']).decode('utf-8')
        if User.query.filter_by(email=email).first():
            return 'Email already exists'
        new_user = User(email=email, password=password)
        db.session.add(new_user)
        db.session.commit()
        login_user(new_user)
        return redirect(url_for('home'))
    return render_template('signup.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/login/google')
def google_login():
    redirect_uri = url_for('google_authorize', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/login/callback')
def google_authorize():
    try:
        token = google.authorize_access_token()
        resp = google.get('userinfo')
        user_info = resp.json()
    except Exception as e:
        print("OAuth error:", e)
        return redirect(url_for('login'))

    if not user_info or 'email' not in user_info:
        return redirect(url_for('login'))

    user = User.query.filter_by(email=user_info['email']).first()
    if not user:
        user = User(email=user_info['email'], oauth_provider='google')
        db.session.add(user)
        db.session.commit()
    login_user(user)
    return redirect(url_for('home'))

@app.route('/chat', methods=['POST'])
@login_required
def chat():
    try:
        user_input = request.form['message']
        current_session_id = request.form.get('session_id')

        # Retrieve session or create new
        chat_session = None
        if current_session_id:
            chat_session = ChatSession.query.filter_by(id=current_session_id, user_id=current_user.id).first()

        if not chat_session:
            now = datetime.utcnow()
            chat_session = ChatSession(
                user_id=current_user.id,
                title=f"Chat started {now.strftime('%Y-%m-%d %H:%M:%S')}",
                created_at=now,
                last_updated=now
            )
            db.session.add(chat_session)
            db.session.commit()

        # Save user message
        user_msg = ChatMessage(
            session_id=chat_session.id,
            role='user',
            content=user_input,
            timestamp=datetime.utcnow()
        )
        db.session.add(user_msg)
        db.session.commit()

        # Prepare messages for OpenRouter
        messages_db = ChatMessage.query.filter_by(session_id=chat_session.id).order_by(ChatMessage.timestamp).all()
        messages = [{"role": "system", "content": "You are a helpful assistant."}]
        for m in messages_db:
            messages.append({"role": m.role, "content": m.content})

        # Call OpenRouter API
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            json={"model": "openai/gpt-3.5-turbo", "messages": messages}
        )

        data = response.json()
        print("OpenRouter Response:", data)

        if 'choices' not in data:
            return jsonify({'response': f"OpenRouter API Error: {data}"}), 500

        reply = data['choices'][0]['message']['content']

        # Save assistant reply
        assistant_msg = ChatMessage(
            session_id=chat_session.id,
            role='assistant',
            content=reply,
            timestamp=datetime.utcnow()
        )
        db.session.add(assistant_msg)

        chat_session.last_updated = datetime.utcnow()
        db.session.commit()

        return jsonify({'response': reply, 'session_id': chat_session.id})

    except Exception as e:
        print("OpenRouter API Error:", e)
        return jsonify({'response': f"Error: {str(e)}"}), 500

@app.route('/sessions')
@login_required
def get_sessions_route():
    sessions = ChatSession.query.filter_by(user_id=current_user.id).order_by(ChatSession.last_updated.desc()).all()
    result = [{"id": s.id, "title": s.title} for s in sessions]
    return jsonify(result)

@app.route('/session/<int:session_id>')
@login_required
def get_session_messages(session_id):
    chat_session = ChatSession.query.filter_by(id=session_id, user_id=current_user.id).first()
    if not chat_session:
        return jsonify({'error': 'Session not found'}), 404
    messages = ChatMessage.query.filter_by(session_id=chat_session.id).order_by(ChatMessage.timestamp).all()
    return jsonify([{"role": m.role, "content": m.content} for m in messages])

@app.route('/delete-session/<int:session_id>', methods=['DELETE'])
@login_required
def delete_session(session_id):
    sess = ChatSession.query.filter_by(id=session_id, user_id=current_user.id).first_or_404()
    db.session.delete(sess)
    db.session.commit()
    return '', 204

@app.route('/static/css/style.css')
def style():
    return app.send_static_file('css/style.css')

if __name__ == "__main__":
    app.run(debug=True)
