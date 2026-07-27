import httpx
import json
import asyncio
from typing import Dict, Any, Optional, List, AsyncGenerator
import streamlit as st
from datetime import datetime

class APIClient:
    """API client for communicating with various LLM providers and local models"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.session = None
    
    async def get_session(self) -> httpx.AsyncClient:
        """Get or create HTTP session"""
        if self.session is None:
            self.session = httpx.AsyncClient(timeout=30.0)
        return self.session
    
    async def close_session(self):
        """Close HTTP session"""
        if self.session:
            await self.session.aclose()
            self.session = None
    
    async def chat_completion(self, model: str, messages: List[Dict[str, str]], 
                            stream: bool = False) -> Dict[str, Any]:
        """Send chat completion request"""
        try:
            if model.startswith("openai:"):
                return await self._openai_chat(model.replace("openai:", ""), messages, stream)
            elif model.startswith("claude:"):
                return await self._claude_chat(model.replace("claude:", ""), messages, stream)
            elif model.startswith("mistral:"):
                return await self._mistral_chat(model.replace("mistral:", ""), messages, stream)
            else:
                # Local model
                return await self._local_chat(model, messages, stream)
        except Exception as e:
            st.error(f"Fehler bei der Chat-Completion: {e}")
            return {"error": str(e)}
    
    async def _openai_chat(self, model: str, messages: List[Dict[str, str]], 
                          stream: bool = False) -> Dict[str, Any]:
        """OpenAI chat completion"""
        api_config = self.config.get("api", {}).get("openai", {})
        if not api_config.get("enabled", False):
            raise Exception("OpenAI API ist nicht aktiviert")
        
        api_key = api_config.get("api_key", "")
        base_url = api_config.get("base_url", "https://api.openai.com/v1")
        
        if not api_key:
            raise Exception("OpenAI API-Schlüssel fehlt")
        
        session = await self.get_session()
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": self.config.get("performance", {}).get("max_tokens", 2048),
            "temperature": self.config.get("performance", {}).get("temperature", 0.7),
            "stream": stream
        }
        
        response = await session.post(f"{base_url}/chat/completions", 
                                    headers=headers, json=payload)
        response.raise_for_status()
        
        return response.json()
    
    async def _claude_chat(self, model: str, messages: List[Dict[str, str]], 
                          stream: bool = False) -> Dict[str, Any]:
        """Claude chat completion"""
        api_config = self.config.get("api", {}).get("claude", {})
        if not api_config.get("enabled", False):
            raise Exception("Claude API ist nicht aktiviert")
        
        api_key = api_config.get("api_key", "")
        if not api_key:
            raise Exception("Claude API-Schlüssel fehlt")
        
        session = await self.get_session()
        
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }
        
        # Convert messages format for Claude
        system_message = ""
        claude_messages = []
        
        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                claude_messages.append(msg)
        
        payload = {
            "model": model,
            "max_tokens": self.config.get("performance", {}).get("max_tokens", 2048),
            "temperature": self.config.get("performance", {}).get("temperature", 0.7),
            "messages": claude_messages,
            "stream": stream
        }
        
        if system_message:
            payload["system"] = system_message
        
        response = await session.post("https://api.anthropic.com/v1/messages", 
                                    headers=headers, json=payload)
        response.raise_for_status()
        
        return response.json()
    
    async def _mistral_chat(self, model: str, messages: List[Dict[str, str]], 
                           stream: bool = False) -> Dict[str, Any]:
        """Mistral chat completion"""
        api_config = self.config.get("api", {}).get("mistral", {})
        if not api_config.get("enabled", False):
            raise Exception("Mistral API ist nicht aktiviert")
        
        api_key = api_config.get("api_key", "")
        if not api_key:
            raise Exception("Mistral API-Schlüssel fehlt")
        
        session = await self.get_session()
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": self.config.get("performance", {}).get("max_tokens", 2048),
            "temperature": self.config.get("performance", {}).get("temperature", 0.7),
            "stream": stream
        }
        
        response = await session.post("https://api.mistral.ai/v1/chat/completions", 
                                    headers=headers, json=payload)
        response.raise_for_status()
        
        return response.json()
    
    async def _local_chat(self, model: str, messages: List[Dict[str, str]], 
                         stream: bool = False) -> Dict[str, Any]:
        """Local model chat completion via Core Engine API"""
        try:
            # Try to connect to local Core Engine API
            session = await self.get_session()
            
            payload = {
                "model": model,
                "messages": messages,
                "max_tokens": self.config.get("performance", {}).get("max_tokens", 2048),
                "temperature": self.config.get("performance", {}).get("temperature", 0.7),
                "stream": stream
            }
            
            # Assume Core Engine runs on localhost:5000
            response = await session.post("http://localhost:5000/api/chat/completions", 
                                        json=payload)
            
            if response.status_code == 200:
                return response.json()
            else:
                # Fallback: simulate local response
                return await self._simulate_local_response(model, messages)
                
        except Exception:
            # Fallback: simulate local response
            return await self._simulate_local_response(model, messages)
    
    async def _simulate_local_response(self, model: str, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        """Simulate local model response for demonstration"""
        await asyncio.sleep(1)  # Simulate processing time
        
        last_message = messages[-1]["content"] if messages else ""
        
        # Simple response simulation
        response_text = f"[Simulierte Antwort von {model}] Ich habe Ihre Nachricht '{last_message[:50]}...' erhalten. Dies ist eine simulierte Antwort, da das lokale Modell noch nicht vollständig integriert ist."
        
        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": response_text
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": len(last_message.split()),
                "completion_tokens": len(response_text.split()),
                "total_tokens": len(last_message.split()) + len(response_text.split())
            },
            "model": model,
            "created": int(datetime.now().timestamp())
        }
    
    async def get_available_models(self) -> Dict[str, List[str]]:
        """Get available models from all providers"""
        models = {
            "local": [],
            "openai": [],
            "claude": [],
            "mistral": []
        }
        
        # Local models
        local_config = self.config.get("local_models", {})
        if local_config.get("enabled", False):
            models["local"] = local_config.get("available_models", [
                "llama-3-8b-instruct",
                "mistral-7b-instruct",
                "codellama-7b-instruct"
            ])
        
        # API models
        api_config = self.config.get("api", {})
        
        if api_config.get("openai", {}).get("enabled", False):
            models["openai"] = [
                "gpt-4",
                "gpt-4-turbo",
                "gpt-3.5-turbo"
            ]
        
        if api_config.get("claude", {}).get("enabled", False):
            models["claude"] = [
                "claude-3-5-sonnet-20241022",
                "claude-3-opus-20240229",
                "claude-3-haiku-20240307"
            ]
        
        if api_config.get("mistral", {}).get("enabled", False):
            models["mistral"] = [
                "mistral-large-latest",
                "mistral-medium-latest",
                "mistral-small-latest"
            ]
        
        return models
    
    async def execute_agent_task(self, agent_name: str, task: str) -> AsyncGenerator[str, None]:
        """Execute agent task and yield progress updates"""
        try:
            # Simulate agent execution with progress updates
            steps = [
                f"🔄 Initialisiere Agent '{agent_name}'...",
                f"📋 Analysiere Aufgabe: '{task[:50]}...'",
                "🔍 Sammle relevante Informationen...",
                "⚙️ Verarbeite Daten...",
                "📝 Erstelle Antwort...",
                "✅ Aufgabe abgeschlossen!"
            ]
            
            for i, step in enumerate(steps):
                yield f"[{i+1}/{len(steps)}] {step}"
                await asyncio.sleep(1)  # Simulate processing time
            
            # Final result
            result = f"""
**Aufgabe:** {task}

**Agent:** {agent_name}

**Ergebnis:**
Die Aufgabe wurde erfolgreich bearbeitet. Dies ist eine simulierte Antwort des Multi-Agent-Systems.

**Details:**
- Verarbeitungszeit: {len(steps)} Sekunden
- Status: Erfolgreich abgeschlossen
- Nächste Schritte: Bereit für weitere Aufgaben

**Hinweis:** Dies ist eine Demonstration der Agent-Funktionalität. In der vollständigen Implementation würde hier die tatsächliche Agent-Logik ausgeführt werden.
            """
            
            yield f"**RESULT**\n{result}"
            
        except Exception as e:
            yield f"❌ Fehler bei der Agent-Ausführung: {e}"
    
    def __del__(self):
        """Cleanup on destruction"""
        if self.session:
            try:
                asyncio.create_task(self.close_session())
            except:
                pass

