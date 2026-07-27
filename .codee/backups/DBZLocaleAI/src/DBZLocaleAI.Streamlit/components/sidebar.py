import streamlit as st

def render_sidebar():
    """
    DBZS Header: Streamlit Sidebar
    Navigationsmenü im DBZS Neon Style
    """
    with st.sidebar:
        st.markdown("<h1 style='color: #00ffff; text-align: center;'>DBZS</h1>", unsafe_allow_html=True)
        st.markdown("<p style='text-align: center; color: #00b4ff;'>Division By Zeros</p>", unsafe_allow_html=True)
        st.markdown("---")
        
        if st.button("📊 Dashboard", use_container_width=True):
            st.session_state.current_page = "Dashboard"
            
        if st.button("💬 Chat", use_container_width=True):
            st.session_state.current_page = "Chat"
            
        if st.button("🤖 Agenten", use_container_width=True):
            st.session_state.current_page = "Agenten"
            
        if st.button("⚙️ Einstellungen", use_container_width=True):
            st.session_state.current_page = "Einstellungen"
            
        st.markdown("---")
        st.markdown("**System Status**")
        st.markdown("🟢 Core Engine: Running")
        st.markdown("🟢 Local LLM: Ready")
        st.markdown("🟡 API Cloud: Connected")
        
        st.markdown("---")
        st.markdown("<div style='font-size: 0.7rem; color: #9696aa;'>DBZ Locale AI v1.0.0</div>", unsafe_allow_html=True)
