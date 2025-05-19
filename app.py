from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_session import Session
from flask_login import LoginManager, login_user, logout_user, login_required, UserMixin, current_user
from authlib.integrations.flask_client import OAuth
from extensions import db, bcrypt  # make sure bcrypt and db are initialized in extensions.py correctly
from datetime import datetime
import requests
import os
from flask import redirect, url_for

# OAuth Key
# OAuth Key
import os
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")



app = Flask(__name__)
app.secret_key = 'your-secret-key'

# App Config
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # Only for local testing, disable in prod

Session(app)  # Must be before db.init_app()

db.init_app(app)
bcrypt.init_app(app)

login_manager = LoginManager(app)
login_manager.login_view = 'login'

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

# Import custom models after db init
from models import User, ChatSession, ChatMessage

# Make sure User model inherits UserMixin (verify in models.py)
# Example:
# class User(db.Model, UserMixin):
#     ...

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# Create tables
with app.app_context():
    db.create_all()


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
        return 'Invalid credentials', 401
    return render_template('login.html')


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        email = request.form['email']
        password = bcrypt.generate_password_hash(request.form['password']).decode('utf-8')
        if User.query.filter_by(email=email).first():
            return 'Email already exists', 400
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
        # User created with OAuth, password set to None
        user = User(email=user_info['email'], oauth_provider='google', password=None)
        db.session.add(user)
        db.session.commit()
    login_user(user)
    return redirect(url_for('home'))

@app.route('/chat', methods=['GET', 'POST'])
@login_required
def chat():
    if request.method == 'POST':
        try:
            user_input = request.form['message']
            current_session_id = request.form.get('session_id')

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

            user_msg = ChatMessage(
                session_id=chat_session.id,
                role='user',
                content=user_input,
                timestamp=datetime.utcnow()
            )
            db.session.add(user_msg)
            db.session.commit()

            messages_db = ChatMessage.query.filter_by(session_id=chat_session.id).order_by(ChatMessage.timestamp).all()
            messages = [{"role": "system", "content": "You are a helpful assistant."}]
            for m in messages_db:
                messages.append({"role": m.role, "content": m.content})

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

    else:
        return render_template('chat.html', username=current_user.email)


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


@app.route('/get_files/<category>')
@login_required
def get_files(category):
    user_id = current_user.id  # fixed: use actual logged in user id
    base_dir = f"uploads/{user_id}/"
    cat_map = {
        "audio": "audio",
        "video": "videos",
        "text": "texts",
        "image": "photos"
    }
    dir_path = os.path.join(base_dir, cat_map.get(category, ""))
    if not os.path.exists(dir_path):
        return jsonify([])

    files = os.listdir(dir_path)
    return jsonify([
        {"name": f, "path": f"/{dir_path}/{f}"} for f in files
    ])


@app.route('/files')
@login_required
def files():
    user_id = current_user.id
    base_dir = f"uploads/{user_id}/"

    all_files = []
    categories = ['audio', 'videos', 'texts', 'photos']

    for cat in categories:
        dir_path = os.path.join(base_dir, cat)
        if not os.path.exists(dir_path):
            continue
        for filename in os.listdir(dir_path):
            filepath = os.path.join(dir_path, filename)
            if os.path.isfile(filepath):
                mtime = os.path.getmtime(filepath)
                all_files.append({
                    'name': filename,
                    'path': f"/{filepath.replace(os.sep, '/')}",
                    'category': cat,
                    'upload_date': datetime.fromtimestamp(mtime)
                })

    all_files.sort(key=lambda x: x['upload_date'], reverse=True)

    return render_template('all-files.html', files=all_files)  # <-- fixed: all_files, not all-files

@app.route('/files/images')
@login_required
def images():
    user_id = current_user.id
    user_photo_dir = os.path.join('uploads', str(user_id), 'photos')

    if not os.path.exists(user_photo_dir):
        files = []
    else:
        files = []
        for filename in os.listdir(user_photo_dir):
            filepath = os.path.join(user_photo_dir, filename)
            if os.path.isfile(filepath):
                mtime = os.path.getmtime(filepath)
                files.append({
                    'name': filename,
                    'url': url_for('uploaded_files', user_id=user_id, subpath=f"photos/{filename}"),
                    'upload_date': datetime.fromtimestamp(mtime)
                })

        files.sort(key=lambda x: x['upload_date'], reverse=True)

    return render_template('images.html', files=files)

@app.route('/files/audio')
@login_required
def audio():
    user_id = current_user.id
    user_audio_dir = os.path.join('uploads', str(user_id), 'audio')

    if not os.path.exists(user_audio_dir):
        files = []
    else:
        files = []
        for filename in os.listdir(user_audio_dir):
            filepath = os.path.join(user_audio_dir, filename)
            if os.path.isfile(filepath):
                mtime = os.path.getmtime(filepath)
                files.append({
                    'name': filename,
                    'url': url_for('uploaded_files', user_id=user_id, subpath=f"audio/{filename}"),
                    'upload_date': datetime.fromtimestamp(mtime)
                })

        files.sort(key=lambda x: x['upload_date'], reverse=True)

    return render_template('audio.html', files=files)


@app.route('/files/video')
@login_required
def video():
    user_id = current_user.id
    user_video_dir = os.path.join('uploads', str(user_id), 'videos')

    if not os.path.exists(user_video_dir):
        files = []
    else:
        files = []
        for filename in os.listdir(user_video_dir):
            filepath = os.path.join(user_video_dir, filename)
            if os.path.isfile(filepath):
                mtime = os.path.getmtime(filepath)
                files.append({
                    'name': filename,
                    'url': url_for('uploaded_files', user_id=user_id, subpath=f"videos/{filename}"),
                    'upload_date': datetime.fromtimestamp(mtime)
                })

        files.sort(key=lambda x: x['upload_date'], reverse=True)

    return render_template('video.html', files=files)


@app.route('/files/documents')
@login_required
def documents():
    user_id = current_user.id
    user_doc_dir = os.path.join('uploads', str(user_id), 'texts')

    if not os.path.exists(user_doc_dir):
        files = []
    else:
        files = []
        for filename in os.listdir(user_doc_dir):
            filepath = os.path.join(user_doc_dir, filename)
            if os.path.isfile(filepath):
                mtime = os.path.getmtime(filepath)
                files.append({
                    'name': filename,
                    'url': url_for('uploaded_files', user_id=user_id, subpath=f"texts/{filename}"),
                    'upload_date': datetime.fromtimestamp(mtime)
                })

        files.sort(key=lambda x: x['upload_date'], reverse=True)

    return render_template('documents.html', files=files)


from flask import request, jsonify
from werkzeug.utils import secure_filename
import os

@app.route('/delete-file/<category>/<filename>', methods=['DELETE'])
@login_required
def delete_file(category, filename):
    # map URL category to your upload folder
    folder_map = {
        'image': 'photos',
        'video': 'videos',
        'audio': 'audio',
        'text': 'texts',
        # you could also support 'others' here if you like
    }
    if category not in folder_map:
        return jsonify({'error': 'Invalid category'}), 400

    user_folder = os.path.join('uploads', str(current_user.id), folder_map[category])
    file_path = os.path.join(user_folder, filename)

    if not os.path.isfile(file_path):
        return jsonify({'error': 'File not found'}), 404

    try:
        os.remove(file_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/upload', methods=['POST'])
@login_required
def upload_file():
    # Check if 'file' part exists in the request
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in request'}), 400

    files = request.files.getlist('file')
    if not files or files[0].filename == '':
        return jsonify({'error': 'No selected file'}), 400

    saved_files = []

    for file in files:
        filename = secure_filename(file.filename)
        ext = filename.rsplit('.', 1)[-1].lower()

        # Folder categorization by file extension
        if ext in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']:
            folder = 'photos'
        elif ext in ['mp4', 'avi', 'mov', 'mkv', 'webm']:
            folder = 'videos'
        elif ext in ['mp3', 'wav', 'aac', 'ogg']:
            folder = 'audio'
        elif ext in ['txt', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']:
            folder = 'texts'
        else:
            folder = 'others'

        # Construct user folder path
        user_folder = os.path.join('uploads', str(current_user.id), folder)
        os.makedirs(user_folder, exist_ok=True)

        # Full path to save the file
        save_path = os.path.join(user_folder, filename)

        # Save the file
        file.save(save_path)

        # Save info for response
        saved_files.append({
            'filename': filename,
            'path': f"/{save_path.replace(os.sep, '/')}",
            'category': folder
        })

    return jsonify({'message': 'Files uploaded successfully', 'files': saved_files})

from flask import send_from_directory

@app.route('/uploads/<int:user_id>/<path:subpath>')
@login_required
def uploaded_files(user_id, subpath):
    if user_id != current_user.id:
        return "Unauthorized", 403
    user_folder = os.path.join('uploads', str(user_id))
    return send_from_directory(user_folder, subpath)


if __name__ == "__main__":
    app.run(debug=True)
