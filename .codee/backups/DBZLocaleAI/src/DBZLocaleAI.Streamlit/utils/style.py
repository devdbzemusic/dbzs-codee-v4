import streamlit as st

def apply_neon_style():
    """
    DBZS Header: Streamlit Neon Style
    Wendet den DBZS Neon Style auf die Streamlit-Anwendung an
    """
    st.markdown("""
        <style>
        /* Hintergrund und Hauptfarben */
        .stApp {
            background-color: #0a0a0f;
            color: #dcdce6;
        }
        
        /* Sidebar */
        [data-testid="stSidebar"] {
            background-color: #14141e;
            border-right: 1px solid #28283c;
        }
        
        /* Header */
        h1, h2, h3 {
            color: #00ffff !important;
            font-family: 'Segoe UI', sans-serif;
            text-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
        }
        
        /* Buttons */
        .stButton>button {
            background-color: #1e1e32;
            color: #00ffff;
            border: 1px solid #00b4ff;
            border-radius: 4px;
            font-weight: bold;
            transition: all 0.3s;
        }
        
        .stButton>button:hover {
            background-color: #00b4ff;
            color: #0a0a0f;
            box-shadow: 0 0 15px rgba(0, 180, 255, 0.5);
        }
        
        /* Input Felder */
        .stTextInput>div>div>input, .stTextArea>div>div>textarea {
            background-color: #0f0f19;
            color: #dcdce6;
            border: 1px solid #28283c;
        }
        
        /* Chat Nachrichten */
        .chat-message {
            padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 1rem; display: flex
        }
        .chat-message.user {
            background-color: #1e1e32; border: 1px solid #00b4ff33;
        }
        .chat-message.bot {
            background-color: #14141e; border: 1px solid #00ffff33;
        }
        
        /* Status Indikatoren */
        .status-running {
            color: #00c864;
            font-weight: bold;
        }
        .status-stopped {
            color: #9696aa;
        }
        
        /* Panels */
        .neon-panel {
            background-color: #14141e;
            border: 1px solid #28283c;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        </style>
    """, unsafe_allow_html=True)

def neon_panel(title, content_func):
    """Erstellt ein Panel im Neon Style"""
    st.markdown(f'<div class="neon-panel"><h3>{title}</h3>', unsafe_allow_html=True)
    content_func()
    st.markdown('</div>', unsafe_allow_html=True)
