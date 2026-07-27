import streamlit as st
import asyncio
import time
from datetime import datetime
from typing import List, Dict, Any
from utils.session_state import (
    add_agent_task, update_agent_task, get_agent_tasks, 
    set_agent_running, is_agent_running
)
from utils.config import get_config_value

def render_agent_interface():
    """Render the multi-agent interface"""
    
    st.header("🤖 Multi-Agent System")
    
    # Agent overview
    render_agent_overview()
    
    st.markdown("---")
    
    # Agent task interface
    col1, col2 = st.columns([2, 1])
    
    with col1:
        render_task_interface()
    
    with col2:
        render_agent_status()
    
    st.markdown("---")
    
    # Task history and management
    render_task_history()

def render_agent_overview():
    """Render agent overview and selection"""
    
    st.markdown("### 🎯 Verfügbare Agenten")
    
    # Get available agents from config
    agents = get_config_value("agents.available_agents", [])
    
    if not agents:
        st.warning("Keine Agenten konfiguriert. Bitte konfigurieren Sie Agenten in den Einstellungen.")
        return
    
    # Display agents in cards
    cols = st.columns(min(len(agents), 3))
    
    for i, agent in enumerate(agents):
        with cols[i % 3]:
            render_agent_card(agent)

def render_agent_card(agent: Dict[str, Any]):
    """Render individual agent card"""
    
    name = agent.get("name", "Unbekannter Agent")
    description = agent.get("description", "Keine Beschreibung verfügbar")
    capabilities = agent.get("capabilities", [])
    
    with st.container():
        st.markdown(f"""
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin: 0.5rem 0; background: white;">
            <h4 style="margin: 0 0 0.5rem 0; color: #1f2937;">🤖 {name}</h4>
            <p style="margin: 0 0 0.5rem 0; color: #6b7280; font-size: 0.9rem;">{description}</p>
            <div style="margin: 0.5rem 0;">
                <strong>Fähigkeiten:</strong><br>
                {', '.join(capabilities) if capabilities else 'Keine angegeben'}
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        # Agent actions
        col1, col2 = st.columns(2)
        with col1:
            if st.button(f"▶️ Starten", key=f"start_{name}", use_container_width=True):
                st.session_state.selected_agent = name
                st.success(f"Agent '{name}' ausgewählt!")
        
        with col2:
            if st.button(f"ℹ️ Details", key=f"details_{name}", use_container_width=True):
                st.session_state.show_agent_details = name

def render_task_interface():
    """Render task creation and execution interface"""
    
    st.markdown("### 📋 Aufgaben-Management")
    
    # Agent selection
    agents = get_config_value("agents.available_agents", [])
    agent_names = [agent["name"] for agent in agents]
    
    if not agent_names:
        st.warning("Keine Agenten verfügbar.")
        return
    
    selected_agent = st.selectbox(
        "Agent auswählen:",
        agent_names,
        index=0 if agent_names else None,
        key="agent_selector"
    )
    
    # Task input
    task_input = st.text_area(
        "Aufgabenbeschreibung:",
        placeholder="Beschreiben Sie die Aufgabe, die der Agent ausführen soll...",
        height=100,
        key="task_input"
    )
    
    # Task options
    with st.expander("⚙️ Erweiterte Optionen"):
        col1, col2 = st.columns(2)
        
        with col1:
            priority = st.selectbox("Priorität:", ["Niedrig", "Normal", "Hoch"], index=1)
            timeout = st.number_input("Timeout (Sekunden):", min_value=30, max_value=3600, value=300)
        
        with col2:
            auto_retry = st.checkbox("Automatisch wiederholen bei Fehler", value=True)
            save_result = st.checkbox("Ergebnis speichern", value=True)
    
    # Execute button
    col1, col2, col3 = st.columns([2, 1, 1])
    
    with col1:
        if st.button("🚀 Aufgabe starten", use_container_width=True, disabled=is_agent_running()):
            if task_input.strip() and selected_agent:
                execute_agent_task(selected_agent, task_input.strip(), {
                    "priority": priority,
                    "timeout": timeout,
                    "auto_retry": auto_retry,
                    "save_result": save_result
                })
            else:
                st.error("Bitte wählen Sie einen Agenten aus und geben Sie eine Aufgabe ein.")
    
    with col2:
        if st.button("⏹️ Stoppen", use_container_width=True, disabled=not is_agent_running()):
            stop_agent_execution()
    
    with col3:
        if st.button("🔄 Status", use_container_width=True):
            st.rerun()

def render_agent_status():
    """Render current agent status"""
    
    st.markdown("### 📊 Agent-Status")
    
    # Current execution status
    if is_agent_running():
        st.markdown("""
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 1rem; margin: 1rem 0;">
            <h4 style="margin: 0; color: #92400e;">🔄 Agent läuft</h4>
            <p style="margin: 0.5rem 0 0 0; color: #92400e;">Ein Agent führt gerade eine Aufgabe aus...</p>
        </div>
        """, unsafe_allow_html=True)
        
        # Progress indicator
        progress_bar = st.progress(0)
        status_text = st.empty()
        
        # Simulate progress updates
        if 'agent_progress' not in st.session_state:
            st.session_state.agent_progress = 0
        
        # Update progress (this would be real progress in actual implementation)
        st.session_state.agent_progress = min(st.session_state.agent_progress + 10, 100)
        progress_bar.progress(st.session_state.agent_progress)
        status_text.text(f"Fortschritt: {st.session_state.agent_progress}%")
        
    else:
        st.markdown("""
        <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 1rem; margin: 1rem 0;">
            <h4 style="margin: 0; color: #065f46;">✅ Bereit</h4>
            <p style="margin: 0.5rem 0 0 0; color: #065f46;">Alle Agenten sind bereit für neue Aufgaben.</p>
        </div>
        """, unsafe_allow_html=True)
    
    # Agent metrics
    st.markdown("#### 📈 Metriken")
    
    tasks = get_agent_tasks()
    completed_tasks = len([t for t in tasks if t["status"] == "completed"])
    failed_tasks = len([t for t in tasks if t["status"] == "failed"])
    pending_tasks = len([t for t in tasks if t["status"] == "pending"])
    
    col1, col2 = st.columns(2)
    with col1:
        st.metric("Abgeschlossen", completed_tasks)
        st.metric("Wartend", pending_tasks)
    
    with col2:
        st.metric("Fehlgeschlagen", failed_tasks)
        st.metric("Gesamt", len(tasks))
    
    # Resource usage (mock data)
    st.markdown("#### 💻 Ressourcen")
    
    col1, col2 = st.columns(2)
    with col1:
        st.metric("CPU", "45%")
        st.metric("RAM", "2.1 GB")
    
    with col2:
        st.metric("GPU", "12%")
        st.metric("VRAM", "1.8 GB")

def render_task_history():
    """Render task history and management"""
    
    st.markdown("### 📚 Aufgaben-Verlauf")
    
    tasks = get_agent_tasks()
    
    if not tasks:
        st.info("Noch keine Aufgaben ausgeführt.")
        return
    
    # Filter options
    col1, col2, col3 = st.columns(3)
    
    with col1:
        status_filter = st.selectbox(
            "Status filtern:",
            ["Alle", "Wartend", "Läuft", "Abgeschlossen", "Fehlgeschlagen"],
            key="status_filter"
        )
    
    with col2:
        agent_filter = st.selectbox(
            "Agent filtern:",
            ["Alle"] + list(set(task["agent_name"] for task in tasks)),
            key="agent_filter"
        )
    
    with col3:
        sort_order = st.selectbox(
            "Sortierung:",
            ["Neueste zuerst", "Älteste zuerst"],
            key="sort_order"
        )
    
    # Apply filters
    filtered_tasks = tasks.copy()
    
    if status_filter != "Alle":
        status_map = {
            "Wartend": "pending",
            "Läuft": "running", 
            "Abgeschlossen": "completed",
            "Fehlgeschlagen": "failed"
        }
        filtered_tasks = [t for t in filtered_tasks if t["status"] == status_map[status_filter]]
    
    if agent_filter != "Alle":
        filtered_tasks = [t for t in filtered_tasks if t["agent_name"] == agent_filter]
    
    # Sort tasks
    reverse_order = sort_order == "Neueste zuerst"
    filtered_tasks.sort(key=lambda x: x["created_at"], reverse=reverse_order)
    
    # Display tasks
    for task in filtered_tasks:
        render_task_card(task)

def render_task_card(task: Dict[str, Any]):
    """Render individual task card"""
    
    task_id = task["id"]
    agent_name = task["agent_name"]
    task_description = task["task"]
    status = task["status"]
    created_at = task["created_at"]
    updated_at = task["updated_at"]
    result = task.get("result", "")
    
    # Status styling
    status_colors = {
        "pending": "#f59e0b",
        "running": "#3b82f6",
        "completed": "#10b981",
        "failed": "#ef4444"
    }
    
    status_icons = {
        "pending": "⏳",
        "running": "🔄",
        "completed": "✅",
        "failed": "❌"
    }
    
    status_color = status_colors.get(status, "#6b7280")
    status_icon = status_icons.get(status, "❓")
    
    with st.expander(f"{status_icon} Aufgabe #{task_id} - {agent_name} ({status})"):
        col1, col2 = st.columns([2, 1])
        
        with col1:
            st.markdown(f"**Beschreibung:** {task_description}")
            st.markdown(f"**Agent:** {agent_name}")
            
            if result:
                st.markdown("**Ergebnis:**")
                st.markdown(result)
        
        with col2:
            st.markdown(f"**Status:** {status_icon} {status}")
            st.markdown(f"**Erstellt:** {created_at.strftime('%H:%M:%S')}")
            st.markdown(f"**Aktualisiert:** {updated_at.strftime('%H:%M:%S')}")
            
            # Task actions
            if status == "pending":
                if st.button(f"▶️ Starten", key=f"start_task_{task_id}"):
                    restart_task(task_id)
            
            if status in ["completed", "failed"]:
                if st.button(f"🔄 Wiederholen", key=f"retry_task_{task_id}"):
                    retry_task(task_id)
            
            if st.button(f"🗑️ Löschen", key=f"delete_task_{task_id}"):
                delete_task(task_id)

def execute_agent_task(agent_name: str, task: str, options: Dict[str, Any]):
    """Execute agent task"""
    
    # Add task to history
    task_id = add_agent_task(agent_name, task, "running")
    set_agent_running(True)
    
    # Show execution progress
    progress_container = st.container()
    
    with progress_container:
        st.info(f"🚀 Starte Aufgabe für Agent '{agent_name}'...")
        
        # Create progress placeholders
        progress_bar = st.progress(0)
        status_text = st.empty()
        output_container = st.container()
        
        try:
            # Simulate agent execution
            steps = [
                "🔄 Initialisiere Agent...",
                "📋 Analysiere Aufgabe...",
                "🔍 Sammle Informationen...",
                "⚙️ Verarbeite Daten...",
                "📝 Erstelle Ergebnis...",
                "✅ Aufgabe abgeschlossen!"
            ]
            
            for i, step in enumerate(steps):
                progress = (i + 1) / len(steps)
                progress_bar.progress(progress)
                status_text.text(f"[{i+1}/{len(steps)}] {step}")
                
                with output_container:
                    st.markdown(f"**{datetime.now().strftime('%H:%M:%S')}** - {step}")
                
                time.sleep(1)  # Simulate processing time
            
            # Generate result
            result = f"""
**Aufgabe erfolgreich abgeschlossen!**

**Agent:** {agent_name}
**Aufgabe:** {task}

**Ergebnis:**
Die Aufgabe wurde erfolgreich von Agent '{agent_name}' bearbeitet. 

**Details:**
- Verarbeitungszeit: {len(steps)} Sekunden
- Status: Erfolgreich abgeschlossen
- Priorität: {options.get('priority', 'Normal')}
- Timeout: {options.get('timeout', 300)} Sekunden

**Zusammenfassung:**
Dies ist eine simulierte Ausführung des Multi-Agent-Systems. In der vollständigen Implementation würde hier die tatsächliche Agent-Logik mit den konfigurierten LLM-Modellen ausgeführt werden.

**Nächste Schritte:**
Der Agent ist bereit für weitere Aufgaben.
            """
            
            # Update task status
            update_agent_task(task_id, "completed", result)
            
            st.success("✅ Aufgabe erfolgreich abgeschlossen!")
            
            with st.expander("📋 Vollständiges Ergebnis anzeigen"):
                st.markdown(result)
            
        except Exception as e:
            # Handle errors
            error_message = f"Fehler bei der Ausführung: {str(e)}"
            update_agent_task(task_id, "failed", error_message)
            st.error(f"❌ {error_message}")
        
        finally:
            set_agent_running(False)
            st.session_state.agent_progress = 0

def stop_agent_execution():
    """Stop current agent execution"""
    set_agent_running(False)
    st.warning("⏹️ Agent-Ausführung gestoppt!")
    
    # Update running tasks to stopped
    tasks = get_agent_tasks("running")
    for task in tasks:
        update_agent_task(task["id"], "failed", "Ausführung vom Benutzer gestoppt")

def restart_task(task_id: int):
    """Restart a pending task"""
    update_agent_task(task_id, "running")
    st.info(f"🔄 Aufgabe #{task_id} wird neu gestartet...")

def retry_task(task_id: int):
    """Retry a completed or failed task"""
    update_agent_task(task_id, "pending")
    st.info(f"🔄 Aufgabe #{task_id} wurde zur Wiederholung markiert.")

def delete_task(task_id: int):
    """Delete a task"""
    # Remove task from session state
    tasks = st.session_state.agent_tasks
    st.session_state.agent_tasks = [t for t in tasks if t["id"] != task_id]
    st.success(f"🗑️ Aufgabe #{task_id} wurde gelöscht.")
    st.rerun()

