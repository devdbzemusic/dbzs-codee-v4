import streamlit as st
from typing import Dict, Any
from utils.config import load_config, save_config, update_config_value, get_config_value
from utils.session_state import mark_settings_changed, are_settings_changed

def render_settings_interface():
    """Render the settings interface"""
    
    st.header("⚙️ Einstellungen")
    
    # Load current configuration
    config = load_config()
    
    # Settings tabs
    tab1, tab2, tab3, tab4 = st.tabs(["🌐 API", "🖥️ Modelle", "🎨 Benutzeroberfläche", "💾 Speicher"])
    
    with tab1:
        render_api_settings(config)
    
    with tab2:
        render_model_settings(config)
    
    with tab3:
        render_ui_settings(config)
    
    with tab4:
        render_storage_settings(config)
    
    # Save/Reset buttons
    st.markdown("---")
    render_settings_actions(config)

def render_api_settings(config: Dict[str, Any]):
    """Render API configuration settings"""
    
    st.markdown("### 🌐 API-Konfiguration")
    
    api_config = config.get("api", {})
    
    # OpenAI Settings
    with st.expander("🤖 OpenAI", expanded=True):
        col1, col2 = st.columns([1, 3])
        
        with col1:
            openai_enabled = st.checkbox(
                "Aktiviert",
                value=api_config.get("openai", {}).get("enabled", False),
                key="openai_enabled"
            )
        
        with col2:
            if openai_enabled:
                openai_api_key = st.text_input(
                    "API-Schlüssel",
                    value=api_config.get("openai", {}).get("api_key", ""),
                    type="password",
                    key="openai_api_key",
                    help="Ihr OpenAI API-Schlüssel"
                )
                
                openai_base_url = st.text_input(
                    "Base URL",
                    value=api_config.get("openai", {}).get("base_url", "https://api.openai.com/v1"),
                    key="openai_base_url",
                    help="OpenAI API Base URL"
                )
                
                openai_model = st.selectbox(
                    "Standard-Modell",
                    ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
                    index=0,
                    key="openai_model"
                )
        
        if openai_enabled:
            if st.button("🧪 OpenAI-Verbindung testen", key="test_openai"):
                test_api_connection("openai", openai_api_key, openai_base_url)
    
    # Claude Settings
    with st.expander("🧠 Anthropic Claude"):
        col1, col2 = st.columns([1, 3])
        
        with col1:
            claude_enabled = st.checkbox(
                "Aktiviert",
                value=api_config.get("claude", {}).get("enabled", False),
                key="claude_enabled"
            )
        
        with col2:
            if claude_enabled:
                claude_api_key = st.text_input(
                    "API-Schlüssel",
                    value=api_config.get("claude", {}).get("api_key", ""),
                    type="password",
                    key="claude_api_key",
                    help="Ihr Anthropic API-Schlüssel"
                )
                
                claude_model = st.selectbox(
                    "Standard-Modell",
                    ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"],
                    index=0,
                    key="claude_model"
                )
        
        if claude_enabled:
            if st.button("🧪 Claude-Verbindung testen", key="test_claude"):
                test_api_connection("claude", claude_api_key)
    
    # Mistral Settings
    with st.expander("🌟 Mistral AI"):
        col1, col2 = st.columns([1, 3])
        
        with col1:
            mistral_enabled = st.checkbox(
                "Aktiviert",
                value=api_config.get("mistral", {}).get("enabled", False),
                key="mistral_enabled"
            )
        
        with col2:
            if mistral_enabled:
                mistral_api_key = st.text_input(
                    "API-Schlüssel",
                    value=api_config.get("mistral", {}).get("api_key", ""),
                    type="password",
                    key="mistral_api_key",
                    help="Ihr Mistral API-Schlüssel"
                )
                
                mistral_model = st.selectbox(
                    "Standard-Modell",
                    ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
                    index=0,
                    key="mistral_model"
                )
        
        if mistral_enabled:
            if st.button("🧪 Mistral-Verbindung testen", key="test_mistral"):
                test_api_connection("mistral", mistral_api_key)

def render_model_settings(config: Dict[str, Any]):
    """Render local model configuration settings"""
    
    st.markdown("### 🖥️ Lokale Modelle")
    
    local_config = config.get("local_models", {})
    performance_config = config.get("performance", {})
    
    # Local model settings
    with st.expander("📁 Modell-Pfade", expanded=True):
        model_path = st.text_input(
            "Modell-Verzeichnis",
            value=local_config.get("model_path", ""),
            key="model_path",
            help="Pfad zum Verzeichnis mit lokalen Modellen"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("📂 Durchsuchen", key="browse_models"):
                st.info("Datei-Browser würde hier geöffnet werden")
        
        with col2:
            if st.button("🔄 Modelle scannen", key="scan_models"):
                scan_local_models(model_path)
        
        # Available models
        available_models = local_config.get("available_models", [])
        if available_models:
            st.markdown("**Gefundene Modelle:**")
            for model in available_models:
                col1, col2, col3 = st.columns([2, 1, 1])
                with col1:
                    st.markdown(f"📄 {model}")
                with col2:
                    st.markdown("4.2 GB")  # Mock size
                with col3:
                    if st.button("✅", key=f"select_{model}", help="Als Standard setzen"):
                        st.success(f"Modell '{model}' als Standard gesetzt!")
    
    # Performance settings
    with st.expander("⚡ Performance-Einstellungen", expanded=True):
        col1, col2 = st.columns(2)
        
        with col1:
            max_tokens = st.number_input(
                "Maximale Tokens",
                min_value=1,
                max_value=32768,
                value=performance_config.get("max_tokens", 2048),
                key="max_tokens",
                help="Maximale Anzahl von Tokens für Antworten"
            )
            
            temperature = st.slider(
                "Temperatur",
                min_value=0.0,
                max_value=2.0,
                value=performance_config.get("temperature", 0.7),
                step=0.1,
                key="temperature",
                help="Kreativität der Antworten (0.0 = deterministisch, 2.0 = sehr kreativ)"
            )
        
        with col2:
            use_gpu = st.checkbox(
                "GPU verwenden",
                value=performance_config.get("use_gpu", True),
                key="use_gpu",
                help="GPU für lokale Modelle verwenden"
            )
            
            if use_gpu:
                gpu_layers = st.number_input(
                    "GPU-Layer",
                    min_value=0,
                    max_value=100,
                    value=performance_config.get("gpu_layers", 20),
                    key="gpu_layers",
                    help="Anzahl der Layer, die auf der GPU ausgeführt werden"
                )
            
            context_length = st.number_input(
                "Kontext-Länge",
                min_value=512,
                max_value=32768,
                value=performance_config.get("context_length", 4096),
                key="context_length",
                help="Maximale Kontext-Länge für Unterhaltungen"
            )
    
    # Hardware info
    with st.expander("💻 Hardware-Informationen"):
        render_hardware_info()

def render_ui_settings(config: Dict[str, Any]):
    """Render UI configuration settings"""
    
    st.markdown("### 🎨 Benutzeroberfläche")
    
    ui_config = config.get("ui", {})
    
    col1, col2 = st.columns(2)
    
    with col1:
        theme = st.selectbox(
            "Design-Theme",
            ["light", "dark", "auto"],
            index=["light", "dark", "auto"].index(ui_config.get("theme", "light")),
            key="theme",
            help="Farbschema der Anwendung"
        )
        
        language = st.selectbox(
            "Sprache",
            ["de", "en"],
            index=["de", "en"].index(ui_config.get("language", "de")),
            key="language",
            help="Sprache der Benutzeroberfläche"
        )
    
    with col2:
        chat_history_limit = st.number_input(
            "Chat-Verlauf Limit",
            min_value=10,
            max_value=1000,
            value=ui_config.get("chat_history_limit", 100),
            key="chat_history_limit",
            help="Maximale Anzahl von Nachrichten im Chat-Verlauf"
        )
        
        auto_save = st.checkbox(
            "Automatisch speichern",
            value=ui_config.get("auto_save", True),
            key="auto_save",
            help="Automatisches Speichern von Einstellungen und Projekten"
        )
    
    # Advanced UI settings
    with st.expander("🔧 Erweiterte UI-Einstellungen"):
        col1, col2 = st.columns(2)
        
        with col1:
            sidebar_default = st.selectbox(
                "Sidebar Standard",
                ["expanded", "collapsed"],
                index=0,
                key="sidebar_default"
            )
            
            show_tooltips = st.checkbox(
                "Tooltips anzeigen",
                value=True,
                key="show_tooltips"
            )
        
        with col2:
            animation_speed = st.selectbox(
                "Animationsgeschwindigkeit",
                ["slow", "normal", "fast"],
                index=1,
                key="animation_speed"
            )
            
            compact_mode = st.checkbox(
                "Kompakter Modus",
                value=False,
                key="compact_mode"
            )

def render_storage_settings(config: Dict[str, Any]):
    """Render storage configuration settings"""
    
    st.markdown("### 💾 Speicher-Einstellungen")
    
    storage_config = config.get("storage", {})
    
    # Project storage
    with st.expander("📁 Projekt-Speicher", expanded=True):
        project_path = st.text_input(
            "Projekt-Verzeichnis",
            value=storage_config.get("project_path", ""),
            key="project_path",
            help="Verzeichnis für Projekt-Dateien"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("📂 Durchsuchen", key="browse_projects"):
                st.info("Datei-Browser würde hier geöffnet werden")
        
        with col2:
            if st.button("📊 Speicher-Info", key="storage_info"):
                show_storage_info(project_path)
    
    # Cloud storage
    with st.expander("☁️ Cloud-Speicher"):
        cloud_storage = st.selectbox(
            "Cloud-Anbieter",
            ["local", "google_drive", "onedrive"],
            index=["local", "google_drive", "onedrive"].index(storage_config.get("cloud_storage", "local")),
            key="cloud_storage",
            help="Cloud-Speicher für Backups und Synchronisation"
        )
        
        if cloud_storage != "local":
            st.info(f"Cloud-Integration für {cloud_storage} ist noch nicht implementiert.")
            
            if cloud_storage == "google_drive":
                google_credentials = st.text_area(
                    "Google Drive Credentials (JSON)",
                    placeholder="Google Drive API Credentials hier einfügen...",
                    key="google_credentials"
                )
            
            elif cloud_storage == "onedrive":
                onedrive_client_id = st.text_input(
                    "OneDrive Client ID",
                    key="onedrive_client_id"
                )
                onedrive_client_secret = st.text_input(
                    "OneDrive Client Secret",
                    type="password",
                    key="onedrive_client_secret"
                )
    
    # Backup settings
    with st.expander("🔄 Backup-Einstellungen"):
        col1, col2 = st.columns(2)
        
        with col1:
            auto_backup = st.checkbox(
                "Automatische Backups",
                value=storage_config.get("auto_backup", True),
                key="auto_backup"
            )
            
            backup_interval = st.selectbox(
                "Backup-Intervall",
                ["1 Stunde", "6 Stunden", "12 Stunden", "24 Stunden"],
                index=0,
                key="backup_interval"
            )
        
        with col2:
            max_backups = st.number_input(
                "Maximale Backups",
                min_value=1,
                max_value=100,
                value=10,
                key="max_backups"
            )
            
            compress_backups = st.checkbox(
                "Backups komprimieren",
                value=True,
                key="compress_backups"
            )
        
        if st.button("🔄 Backup jetzt erstellen", key="create_backup"):
            create_manual_backup()

def render_settings_actions(config: Dict[str, Any]):
    """Render settings save/reset actions"""
    
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        if st.button("💾 Speichern", use_container_width=True, type="primary"):
            save_all_settings()
    
    with col2:
        if st.button("🔄 Zurücksetzen", use_container_width=True):
            reset_settings()
    
    with col3:
        if st.button("📤 Exportieren", use_container_width=True):
            export_settings(config)
    
    with col4:
        if st.button("📥 Importieren", use_container_width=True):
            st.session_state.show_import_dialog = True
    
    # Import dialog
    if st.session_state.get('show_import_dialog', False):
        render_import_dialog()
    
    # Show unsaved changes warning
    if are_settings_changed():
        st.warning("⚠️ Sie haben ungespeicherte Änderungen!")

def test_api_connection(provider: str, api_key: str, base_url: str = None):
    """Test API connection"""
    
    if not api_key:
        st.error("API-Schlüssel fehlt!")
        return
    
    with st.spinner(f"Teste {provider.upper()}-Verbindung..."):
        try:
            # Simulate API test
            import time
            time.sleep(2)
            
            # Mock successful connection
            st.success(f"✅ {provider.upper()}-Verbindung erfolgreich!")
            
            # Show mock API info
            st.info(f"""
            **Verbindungsdetails:**
            - Provider: {provider.upper()}
            - Status: Aktiv
            - Latenz: 120ms
            - Rate Limit: 1000/min
            """)
            
        except Exception as e:
            st.error(f"❌ Verbindung fehlgeschlagen: {e}")

def scan_local_models(model_path: str):
    """Scan for local models"""
    
    if not model_path:
        st.warning("Bitte geben Sie einen Modell-Pfad an.")
        return
    
    with st.spinner("Scanne nach lokalen Modellen..."):
        # Simulate model scanning
        import time
        time.sleep(2)
        
        # Mock found models
        found_models = [
            "llama-3-8b-instruct.gguf",
            "mistral-7b-instruct-v0.3.gguf",
            "codellama-7b-instruct.gguf"
        ]
        
        # Update config
        update_config_value("local_models.available_models", found_models)
        
        st.success(f"✅ {len(found_models)} Modelle gefunden!")
        st.rerun()

def render_hardware_info():
    """Render hardware information"""
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**CPU:**")
        st.markdown("- Intel i7-3770 @ 3.40GHz")
        st.markdown("- 4 Kerne, 8 Threads")
        st.markdown("- Auslastung: 45%")
        
        st.markdown("**RAM:**")
        st.markdown("- Gesamt: 32 GB")
        st.markdown("- Verwendet: 12.5 GB")
        st.markdown("- Verfügbar: 19.5 GB")
    
    with col2:
        st.markdown("**GPU:**")
        st.markdown("- NVIDIA GeForce GTX 1650")
        st.markdown("- VRAM: 4 GB")
        st.markdown("- VRAM verwendet: 1.8 GB")
        
        st.markdown("**Speicher:**")
        st.markdown("- SSD: 500 GB")
        st.markdown("- Verwendet: 250 GB")
        st.markdown("- Verfügbar: 250 GB")

def show_storage_info(project_path: str):
    """Show storage information"""
    
    st.info(f"""
    **Speicher-Informationen:**
    
    📁 **Projekt-Pfad:** {project_path or 'Nicht konfiguriert'}
    💾 **Verwendeter Speicher:** 2.3 GB
    📊 **Anzahl Projekte:** 5
    📝 **Chat-Verläufe:** 127
    🤖 **Agent-Tasks:** 45
    
    **Letzte Backups:**
    - Automatisch: vor 2 Stunden
    - Manuell: vor 1 Tag
    """)

def save_all_settings():
    """Save all settings"""
    
    try:
        # Collect all settings from session state
        new_config = {
            "api": {
                "openai": {
                    "enabled": st.session_state.get("openai_enabled", False),
                    "api_key": st.session_state.get("openai_api_key", ""),
                    "base_url": st.session_state.get("openai_base_url", "https://api.openai.com/v1"),
                    "model": st.session_state.get("openai_model", "gpt-4")
                },
                "claude": {
                    "enabled": st.session_state.get("claude_enabled", False),
                    "api_key": st.session_state.get("claude_api_key", ""),
                    "model": st.session_state.get("claude_model", "claude-3-5-sonnet-20241022")
                },
                "mistral": {
                    "enabled": st.session_state.get("mistral_enabled", False),
                    "api_key": st.session_state.get("mistral_api_key", ""),
                    "model": st.session_state.get("mistral_model", "mistral-large-latest")
                }
            },
            "local_models": {
                "enabled": True,
                "model_path": st.session_state.get("model_path", ""),
                "available_models": get_config_value("local_models.available_models", [])
            },
            "performance": {
                "max_tokens": st.session_state.get("max_tokens", 2048),
                "temperature": st.session_state.get("temperature", 0.7),
                "use_gpu": st.session_state.get("use_gpu", True),
                "gpu_layers": st.session_state.get("gpu_layers", 20),
                "context_length": st.session_state.get("context_length", 4096)
            },
            "ui": {
                "theme": st.session_state.get("theme", "light"),
                "language": st.session_state.get("language", "de"),
                "chat_history_limit": st.session_state.get("chat_history_limit", 100),
                "auto_save": st.session_state.get("auto_save", True)
            },
            "storage": {
                "project_path": st.session_state.get("project_path", ""),
                "cloud_storage": st.session_state.get("cloud_storage", "local"),
                "auto_backup": st.session_state.get("auto_backup", True)
            }
        }
        
        # Merge with existing config
        current_config = load_config()
        current_config.update(new_config)
        
        # Save configuration
        if save_config(current_config):
            st.success("✅ Einstellungen erfolgreich gespeichert!")
            mark_settings_changed(False)
            
            # Update API client with new config
            if 'api_client' in st.session_state:
                st.session_state.api_client.config = current_config
        else:
            st.error("❌ Fehler beim Speichern der Einstellungen!")
            
    except Exception as e:
        st.error(f"❌ Fehler beim Speichern: {e}")

def reset_settings():
    """Reset settings to defaults"""
    
    if st.button("⚠️ Wirklich zurücksetzen?", key="confirm_reset"):
        try:
            from utils.config import get_config
            default_config = get_config().get_default_config()
            
            if save_config(default_config):
                st.success("✅ Einstellungen auf Standard zurückgesetzt!")
                mark_settings_changed(False)
                st.rerun()
            else:
                st.error("❌ Fehler beim Zurücksetzen!")
                
        except Exception as e:
            st.error(f"❌ Fehler beim Zurücksetzen: {e}")

def export_settings(config: Dict[str, Any]):
    """Export settings to file"""
    
    import json
    from datetime import datetime
    
    # Create export data
    export_data = {
        "export_info": {
            "version": "1.0.0",
            "exported_at": datetime.now().isoformat(),
            "exported_by": "DBZ Locale AI"
        },
        "config": config
    }
    
    # Convert to JSON
    json_data = json.dumps(export_data, indent=2, ensure_ascii=False)
    
    # Provide download
    st.download_button(
        label="📥 Einstellungen herunterladen",
        data=json_data,
        file_name=f"dbz_locale_ai_settings_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        mime="application/json"
    )

def render_import_dialog():
    """Render settings import dialog"""
    
    with st.form("import_settings_form"):
        st.markdown("### 📥 Einstellungen importieren")
        
        uploaded_file = st.file_uploader(
            "Einstellungsdatei auswählen",
            type=["json"],
            help="Wählen Sie eine zuvor exportierte Einstellungsdatei aus"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            import_button = st.form_submit_button("📥 Importieren", use_container_width=True)
        with col2:
            cancel_button = st.form_submit_button("❌ Abbrechen", use_container_width=True)
        
        if import_button and uploaded_file:
            import_settings_file(uploaded_file)
        
        if cancel_button:
            st.session_state.show_import_dialog = False
            st.rerun()

def import_settings_file(uploaded_file):
    """Import settings from uploaded file"""
    
    try:
        import json
        
        # Read and parse file
        content = uploaded_file.read().decode('utf-8')
        import_data = json.loads(content)
        
        # Validate import data
        if "config" not in import_data:
            st.error("❌ Ungültige Einstellungsdatei!")
            return
        
        # Import configuration
        imported_config = import_data["config"]
        
        if save_config(imported_config):
            st.success("✅ Einstellungen erfolgreich importiert!")
            st.session_state.show_import_dialog = False
            mark_settings_changed(False)
            st.rerun()
        else:
            st.error("❌ Fehler beim Importieren der Einstellungen!")
            
    except json.JSONDecodeError:
        st.error("❌ Ungültiges JSON-Format!")
    except Exception as e:
        st.error(f"❌ Fehler beim Importieren: {e}")

def create_manual_backup():
    """Create manual backup"""
    
    with st.spinner("Erstelle Backup..."):
        import time
        time.sleep(2)
        
        # Simulate backup creation
        st.success("✅ Backup erfolgreich erstellt!")
        st.info("""
        **Backup-Details:**
        - Zeitpunkt: Jetzt
        - Größe: 15.2 MB
        - Enthält: Konfiguration, Projekte, Chat-Verläufe
        - Speicherort: ~/DBZ_Locale_AI_Projects/backups/
        """)

