import streamlit as st
import asyncio
from datetime import datetime
from typing import List, Dict, Any
from utils.session_state import (
    add_chat_message, get_chat_history, clear_chat_history, 
    set_current_model, get_current_model, update_metrics
)
from utils.config import get_available_models

def render_chat_interface():
    """Render the main chat interface"""
    
    st.header("💬 Chat Interface")
    
    # Model selection
    render_model_selector()
    
    # Chat controls
    col1, col2, col3, col4 = st.columns([2, 1, 1, 1])
    
    with col1:
        st.markdown("### 🤖 Aktives Modell")
        current_model = get_current_model()
        if current_model:
            st.success(f"**{current_model}**")
        else:
            st.warning("Kein Modell ausgewählt")
    
    with col2:
        if st.button("🧹 Chat löschen", use_container_width=True):
            clear_chat_history()
            st.success("Chat-Verlauf gelöscht!")
            st.rerun()
    
    with col3:
        if st.button("💾 Exportieren", use_container_width=True):
            export_chat_history()
    
    with col4:
        if st.button("📊 Statistiken", use_container_width=True):
            st.session_state.show_chat_stats = not st.session_state.get('show_chat_stats', False)
    
    # Chat statistics (if enabled)
    if st.session_state.get('show_chat_stats', False):
        render_chat_statistics()
    
    st.markdown("---")
    
    # Chat history display
    render_chat_history()
    
    # Message input
    render_message_input()

def render_model_selector():
    """Render model selection interface"""
    
    st.markdown("### 🎯 Modell-Auswahl")
    
    models = get_available_models()
    
    # Create tabs for different model categories
    tabs = []
    tab_names = []
    
    if models.get("local"):
        tab_names.append("🖥️ Lokal")
        tabs.append("local")
    
    if models.get("api"):
        tab_names.append("🌐 API")
        tabs.append("api")
    
    if not tabs:
        st.warning("Keine Modelle verfügbar. Bitte konfigurieren Sie zuerst Ihre Modelle in den Einstellungen.")
        return
    
    # Create tabs
    tab_objects = st.tabs(tab_names)
    
    for i, (tab_obj, tab_type) in enumerate(zip(tab_objects, tabs)):
        with tab_obj:
            if tab_type == "local":
                render_local_models(models["local"])
            elif tab_type == "api":
                render_api_models(models["api"])

def render_local_models(local_models: List[str]):
    """Render local model selection"""
    
    if not local_models:
        st.info("Keine lokalen Modelle verfügbar.")
        return
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        selected_model = st.selectbox(
            "Lokales Modell:",
            local_models,
            key="local_model_selector"
        )
    
    with col2:
        if st.button("✅ Auswählen", key="select_local_model"):
            set_current_model(f"local:{selected_model}")
            st.success(f"Modell '{selected_model}' ausgewählt!")
            st.rerun()
    
    # Model info
    if selected_model:
        render_model_info(selected_model, "local")

def render_api_models(api_models: List[str]):
    """Render API model selection"""
    
    if not api_models:
        st.info("Keine API-Modelle verfügbar.")
        return
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        selected_model = st.selectbox(
            "API-Modell:",
            api_models,
            key="api_model_selector"
        )
    
    with col2:
        if st.button("✅ Auswählen", key="select_api_model"):
            set_current_model(selected_model)
            st.success(f"Modell '{selected_model}' ausgewählt!")
            st.rerun()
    
    # Model info
    if selected_model:
        provider = selected_model.split(":")[0] if ":" in selected_model else "unknown"
        model_name = selected_model.split(":")[1] if ":" in selected_model else selected_model
        render_model_info(model_name, provider)

def render_model_info(model_name: str, provider: str):
    """Render model information"""
    
    with st.expander("ℹ️ Modell-Informationen"):
        col1, col2 = st.columns(2)
        
        with col1:
            st.markdown(f"**Name:** {model_name}")
            st.markdown(f"**Anbieter:** {provider}")
        
        with col2:
            # Mock model specifications
            if "llama" in model_name.lower():
                st.markdown("**Parameter:** 8B")
                st.markdown("**Kontext:** 4096 Tokens")
            elif "mistral" in model_name.lower():
                st.markdown("**Parameter:** 7B")
                st.markdown("**Kontext:** 8192 Tokens")
            elif "gpt" in model_name.lower():
                st.markdown("**Parameter:** Unbekannt")
                st.markdown("**Kontext:** 8192 Tokens")
            elif "claude" in model_name.lower():
                st.markdown("**Parameter:** Unbekannt")
                st.markdown("**Kontext:** 200k Tokens")
        
        # Performance settings
        st.markdown("**Performance-Einstellungen:**")
        col1, col2 = st.columns(2)
        
        with col1:
            temperature = st.slider("Temperatur", 0.0, 2.0, 0.7, 0.1, key=f"temp_{model_name}")
        
        with col2:
            max_tokens = st.number_input("Max Tokens", 1, 4096, 2048, key=f"tokens_{model_name}")

def render_chat_history():
    """Render chat message history"""
    
    history = get_chat_history()
    
    if not history:
        st.info("Noch keine Nachrichten. Beginnen Sie eine Unterhaltung!")
        return
    
    # Chat container
    chat_container = st.container()
    
    with chat_container:
        for i, message in enumerate(history):
            render_chat_message(message, i)

def render_chat_message(message: Dict[str, Any], index: int):
    """Render a single chat message"""
    
    role = message["role"]
    content = message["content"]
    timestamp = message.get("timestamp", datetime.now())
    model = message.get("model", "")
    metadata = message.get("metadata", {})
    
    # Message container with styling
    if role == "user":
        # User message (right-aligned, blue)
        st.markdown(f"""
        <div style="display: flex; justify-content: flex-end; margin: 1rem 0;">
            <div style="background: #3b82f6; color: white; padding: 1rem; border-radius: 1rem 1rem 0.2rem 1rem; max-width: 70%; word-wrap: break-word;">
                <div style="font-size: 0.9rem; margin-bottom: 0.5rem;">
                    <strong>Sie</strong> • {timestamp.strftime("%H:%M")}
                </div>
                <div>{content}</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
    
    elif role == "assistant":
        # Assistant message (left-aligned, gray)
        st.markdown(f"""
        <div style="display: flex; justify-content: flex-start; margin: 1rem 0;">
            <div style="background: #f1f5f9; color: #1e293b; padding: 1rem; border-radius: 1rem 1rem 1rem 0.2rem; max-width: 70%; word-wrap: break-word;">
                <div style="font-size: 0.9rem; margin-bottom: 0.5rem; color: #64748b;">
                    <strong>🤖 {model or 'AI'}</strong> • {timestamp.strftime("%H:%M")}
                </div>
                <div>{content}</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        # Show metadata if available
        if metadata:
            with st.expander(f"📊 Details (Nachricht {index + 1})", expanded=False):
                col1, col2, col3 = st.columns(3)
                
                with col1:
                    if "tokens" in metadata:
                        st.metric("Tokens", metadata["tokens"])
                
                with col2:
                    if "response_time" in metadata:
                        st.metric("Antwortzeit", f"{metadata['response_time']:.2f}s")
                
                with col3:
                    if "finish_reason" in metadata:
                        st.metric("Status", metadata["finish_reason"])
    
    elif role == "system":
        # System message (centered, yellow)
        st.markdown(f"""
        <div style="display: flex; justify-content: center; margin: 1rem 0;">
            <div style="background: #fef3c7; color: #92400e; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.9rem; text-align: center;">
                <strong>System:</strong> {content}
            </div>
        </div>
        """, unsafe_allow_html=True)

def render_message_input():
    """Render message input interface"""
    
    current_model = get_current_model()
    
    if not current_model:
        st.warning("⚠️ Bitte wählen Sie zuerst ein Modell aus.")
        return
    
    # Message input form
    with st.form("message_form", clear_on_submit=True):
        col1, col2 = st.columns([4, 1])
        
        with col1:
            user_input = st.text_area(
                "Ihre Nachricht:",
                placeholder="Geben Sie hier Ihre Nachricht ein...",
                height=100,
                key="message_input"
            )
        
        with col2:
            st.markdown("<br>", unsafe_allow_html=True)  # Spacing
            send_button = st.form_submit_button("📤 Senden", use_container_width=True)
            
            # Advanced options
            with st.expander("⚙️ Erweitert"):
                stream_response = st.checkbox("Stream-Antwort", value=True)
                include_context = st.checkbox("Kontext einbeziehen", value=True)
        
        if send_button and user_input.strip():
            handle_user_message(user_input.strip(), current_model, stream_response, include_context)

def handle_user_message(message: str, model: str, stream: bool = True, include_context: bool = True):
    """Handle user message and generate response"""
    
    # Add user message to history
    add_chat_message("user", message)
    
    # Prepare messages for API
    messages = []
    
    if include_context:
        # Include recent chat history
        history = get_chat_history(limit=10)  # Last 10 messages
        for msg in history[:-1]:  # Exclude the just-added message
            if msg["role"] in ["user", "assistant"]:
                messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })
    
    # Add current message
    messages.append({"role": "user", "content": message})
    
    # Show processing indicator
    with st.spinner("🤖 Generiere Antwort..."):
        try:
            # Get API client
            api_client = st.session_state.api_client
            
            # Generate response
            start_time = datetime.now()
            
            if stream:
                # Streaming response
                response_placeholder = st.empty()
                full_response = ""
                
                # Simulate streaming (in real implementation, this would be actual streaming)
                import time
                response_text = f"Das ist eine simulierte Antwort auf Ihre Nachricht: '{message}'. Das Modell {model} würde hier eine echte Antwort generieren."
                
                for i, char in enumerate(response_text):
                    full_response += char
                    response_placeholder.markdown(f"🤖 **{model}**: {full_response}▋")
                    time.sleep(0.02)  # Simulate typing
                
                response_placeholder.markdown(f"🤖 **{model}**: {full_response}")
                
            else:
                # Non-streaming response
                response_text = f"Das ist eine simulierte Antwort auf Ihre Nachricht: '{message}'. Das Modell {model} würde hier eine echte Antwort generieren."
                st.markdown(f"🤖 **{model}**: {response_text}")
            
            # Calculate response time
            end_time = datetime.now()
            response_time = (end_time - start_time).total_seconds()
            
            # Add assistant message to history
            metadata = {
                "tokens": len(response_text.split()),
                "response_time": response_time,
                "finish_reason": "stop",
                "model_used": model
            }
            
            add_chat_message("assistant", response_text, model, metadata)
            
            # Update metrics
            update_metrics("average_response_time", response_time)
            
            st.rerun()
            
        except Exception as e:
            st.error(f"Fehler bei der Antwortgenerierung: {e}")
            add_chat_message("system", f"Fehler: {e}")

def render_chat_statistics():
    """Render chat statistics"""
    
    history = get_chat_history()
    
    if not history:
        st.info("Keine Statistiken verfügbar.")
        return
    
    st.markdown("### 📊 Chat-Statistiken")
    
    col1, col2, col3, col4 = st.columns(4)
    
    # Count messages by role
    user_messages = len([m for m in history if m["role"] == "user"])
    assistant_messages = len([m for m in history if m["role"] == "assistant"])
    total_messages = len(history)
    
    # Calculate total tokens
    total_tokens = sum(m.get("metadata", {}).get("tokens", 0) for m in history)
    
    with col1:
        st.metric("Gesamt", total_messages)
    
    with col2:
        st.metric("Benutzer", user_messages)
    
    with col3:
        st.metric("AI", assistant_messages)
    
    with col4:
        st.metric("Tokens", total_tokens)
    
    # Model usage
    model_usage = {}
    for msg in history:
        if msg["role"] == "assistant":
            model = msg.get("model", "Unbekannt")
            model_usage[model] = model_usage.get(model, 0) + 1
    
    if model_usage:
        st.markdown("#### 🤖 Modell-Nutzung")
        for model, count in model_usage.items():
            st.markdown(f"- **{model}**: {count} Nachrichten")

def export_chat_history():
    """Export chat history"""
    
    history = get_chat_history()
    
    if not history:
        st.warning("Kein Chat-Verlauf zum Exportieren vorhanden.")
        return
    
    # Create export content
    export_content = "# DBZ Locale AI - Chat Export\n\n"
    export_content += f"Exportiert am: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    
    for msg in history:
        timestamp = msg.get("timestamp", datetime.now()).strftime("%H:%M:%S")
        role = msg["role"]
        content = msg["content"]
        model = msg.get("model", "")
        
        if role == "user":
            export_content += f"**[{timestamp}] Sie:**\n{content}\n\n"
        elif role == "assistant":
            export_content += f"**[{timestamp}] AI ({model}):**\n{content}\n\n"
        elif role == "system":
            export_content += f"**[{timestamp}] System:**\n{content}\n\n"
    
    # Provide download
    st.download_button(
        label="📥 Chat als Markdown herunterladen",
        data=export_content,
        file_name=f"chat_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md",
        mime="text/markdown"
    )

