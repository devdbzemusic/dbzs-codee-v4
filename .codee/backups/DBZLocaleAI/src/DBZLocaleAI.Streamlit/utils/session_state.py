import streamlit as st
from typing import Dict, Any, List
from datetime import datetime

def initialize_session_state():
    """Initialize Streamlit session state with default values"""
    
    # Chat history
    if 'chat_history' not in st.session_state:
        st.session_state.chat_history = []
    
    # Current model
    if 'current_model' not in st.session_state:
        st.session_state.current_model = None
    
    # Agent state
    if 'agent_tasks' not in st.session_state:
        st.session_state.agent_tasks = []
    
    if 'active_agent' not in st.session_state:
        st.session_state.active_agent = None
    
    if 'agent_running' not in st.session_state:
        st.session_state.agent_running = False
    
    # Settings state
    if 'settings_changed' not in st.session_state:
        st.session_state.settings_changed = False
    
    # UI state
    if 'sidebar_state' not in st.session_state:
        st.session_state.sidebar_state = "expanded"
    
    if 'current_page' not in st.session_state:
        st.session_state.current_page = "Dashboard"
    
    # Performance metrics
    if 'metrics' not in st.session_state:
        st.session_state.metrics = {
            'total_messages': 0,
            'total_tokens': 0,
            'average_response_time': 0.0,
            'active_models': 0,
            'agent_tasks_completed': 0
        }
    
    # Project state
    if 'current_project' not in st.session_state:
        st.session_state.current_project = None
    
    if 'project_history' not in st.session_state:
        st.session_state.project_history = []

def add_chat_message(role: str, content: str, model: str = None, metadata: Dict[str, Any] = None):
    """Add a message to chat history"""
    message = {
        'role': role,
        'content': content,
        'timestamp': datetime.now(),
        'model': model,
        'metadata': metadata or {}
    }
    
    st.session_state.chat_history.append(message)
    
    # Update metrics
    st.session_state.metrics['total_messages'] += 1
    if metadata and 'tokens' in metadata:
        st.session_state.metrics['total_tokens'] += metadata['tokens']

def get_chat_history(limit: int = None) -> List[Dict[str, Any]]:
    """Get chat history with optional limit"""
    history = st.session_state.chat_history
    if limit:
        return history[-limit:]
    return history

def clear_chat_history():
    """Clear chat history"""
    st.session_state.chat_history = []

def set_current_model(model: str):
    """Set current model"""
    st.session_state.current_model = model

def get_current_model() -> str:
    """Get current model"""
    return st.session_state.current_model

def add_agent_task(agent_name: str, task: str, status: str = "pending"):
    """Add agent task"""
    task_data = {
        'id': len(st.session_state.agent_tasks) + 1,
        'agent_name': agent_name,
        'task': task,
        'status': status,
        'created_at': datetime.now(),
        'updated_at': datetime.now(),
        'result': None
    }
    
    st.session_state.agent_tasks.append(task_data)
    return task_data['id']

def update_agent_task(task_id: int, status: str = None, result: str = None):
    """Update agent task"""
    for task in st.session_state.agent_tasks:
        if task['id'] == task_id:
            if status:
                task['status'] = status
            if result:
                task['result'] = result
            task['updated_at'] = datetime.now()
            break

def get_agent_tasks(status: str = None) -> List[Dict[str, Any]]:
    """Get agent tasks with optional status filter"""
    tasks = st.session_state.agent_tasks
    if status:
        return [task for task in tasks if task['status'] == status]
    return tasks

def set_agent_running(running: bool):
    """Set agent running state"""
    st.session_state.agent_running = running

def is_agent_running() -> bool:
    """Check if agent is running"""
    return st.session_state.agent_running

def update_metrics(key: str, value: Any):
    """Update performance metrics"""
    if key in st.session_state.metrics:
        st.session_state.metrics[key] = value

def get_metrics() -> Dict[str, Any]:
    """Get performance metrics"""
    return st.session_state.metrics

def set_current_page(page: str):
    """Set current page"""
    st.session_state.current_page = page

def get_current_page() -> str:
    """Get current page"""
    return st.session_state.current_page

def mark_settings_changed(changed: bool = True):
    """Mark settings as changed"""
    st.session_state.settings_changed = changed

def are_settings_changed() -> bool:
    """Check if settings have changed"""
    return st.session_state.settings_changed

def create_project(name: str, description: str = "") -> Dict[str, Any]:
    """Create a new project"""
    project = {
        'id': len(st.session_state.project_history) + 1,
        'name': name,
        'description': description,
        'created_at': datetime.now(),
        'updated_at': datetime.now(),
        'chat_history': [],
        'agent_tasks': [],
        'settings': {}
    }
    
    st.session_state.project_history.append(project)
    st.session_state.current_project = project
    return project

def load_project(project_id: int) -> bool:
    """Load a project by ID"""
    for project in st.session_state.project_history:
        if project['id'] == project_id:
            st.session_state.current_project = project
            st.session_state.chat_history = project.get('chat_history', [])
            st.session_state.agent_tasks = project.get('agent_tasks', [])
            return True
    return False

def save_current_project():
    """Save current state to current project"""
    if st.session_state.current_project:
        st.session_state.current_project['chat_history'] = st.session_state.chat_history
        st.session_state.current_project['agent_tasks'] = st.session_state.agent_tasks
        st.session_state.current_project['updated_at'] = datetime.now()

def get_projects() -> List[Dict[str, Any]]:
    """Get all projects"""
    return st.session_state.project_history

def get_current_project() -> Dict[str, Any]:
    """Get current project"""
    return st.session_state.current_project

def reset_session():
    """Reset session state to defaults"""
    keys_to_keep = ['config', 'api_client']  # Keep these across resets
    
    for key in list(st.session_state.keys()):
        if key not in keys_to_keep:
            del st.session_state[key]
    
    initialize_session_state()

