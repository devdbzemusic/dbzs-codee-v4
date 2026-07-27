import streamlit as st
from utils.style import apply_neon_style, neon_panel
from components.sidebar import render_sidebar
from components.chat_interface import render_chat
from components.agent_interface import render_agent
from components.settings_interface import render_settings

# DBZS Header: Streamlit Main Application
# Zentrale Steuerung der Webansicht im DBZS Neon Style

st.set_page_config(
    page_title="DBZ Locale AI - Division By Zeros",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Style anwenden
apply_neon_style()

# Session State Initialisierung
if "current_page" not in st.session_state:
    st.session_state.current_page = "Dashboard"

# Sidebar rendern
render_sidebar()

# Hauptinhalt basierend auf Navigation
if st.session_state.current_page == "Dashboard":
    st.title("DBZ LOCALE AI")
    st.subheader("Division By Zeros (DBZS) - Local AI Ecosystem")
    
    col1, col2 = st.columns(2)
    
    with col1:
        def render_slots():
            st.markdown("""
                | Slot | Modell | Status |
                | :--- | :--- | :--- |
                | **fast_gpu** | Llama-3.2-1B | <span class="status-running">Running</span> |
                | **quality_cpu** | Mistral-7B | <span class="status-stopped">Stopped</span> |
                | **utility** | None | <span class="status-stopped">Stopped</span> |
            """, unsafe_allow_html=True)
            st.button("Alle Slots neu starten")
            
        neon_panel("Runtime Slots", render_slots)
        
    with col2:
        def render_stats():
            st.write("**System-Ressourcen**")
            st.progress(0.4, text="GPU VRAM (GTX 1650): 1.6 / 4.0 GB")
            st.progress(0.2, text="CPU Usage: 18%")
            st.progress(0.3, text="RAM Usage: 9.6 / 32.0 GB")
            
        neon_panel("System Status", render_stats)

elif st.session_state.current_page == "Chat":
    render_chat()

elif st.session_state.current_page == "Agenten":
    render_agent()

elif st.session_state.current_page == "Einstellungen":
    render_settings()

# Footer
st.markdown("---")
st.markdown(
    "<div style='text-align: center; color: #9696aa; font-size: 0.8rem;'>"
    "DBZ Locale AI v1.0.0 | © 2025 Division By Zeros (DBZS) | Windows-First & Local-First AI"
    "</div>", 
    unsafe_allow_html=True
)
