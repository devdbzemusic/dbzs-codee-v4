using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

namespace DBZLocaleAI.Core.EventBus
{
    /// <summary>
    /// DBZS Header: EventBus für interne Kommunikation
    /// Zentrales Event-Verteilungssystem für alle Komponenten
    /// Ermöglicht lose Kopplung zwischen Services
    /// </summary>
    public interface IEventBus
    {
        /// <summary>
        /// Subscribes to an event type
        /// </summary>
        IDisposable Subscribe<TEvent>(Action<TEvent> handler) where TEvent : class;

        /// <summary>
        /// Publishes an event to all subscribers
        /// </summary>
        void Publish<TEvent>(TEvent @event) where TEvent : class;

        /// <summary>
        /// Publishes an event asynchronously
        /// </summary>
        Task PublishAsync<TEvent>(TEvent @event) where TEvent : class;

        /// <summary>
        /// Gets the number of subscribers for an event type
        /// </summary>
        int GetSubscriberCount<TEvent>() where TEvent : class;

        /// <summary>
        /// Clears all subscribers (for testing)
        /// </summary>
        void Clear();
    }

    /// <summary>
    /// Base class for all events
    /// </summary>
    public abstract class DomainEvent
    {
        public string EventId { get; } = Guid.NewGuid().ToString();
        public DateTime OccurredAt { get; } = DateTime.UtcNow;
        public string Source { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Default EventBus implementation
    /// Thread-safe, supports synchronous and asynchronous publishing
    /// </summary>
    public class DefaultEventBus : IEventBus
    {
        private readonly Dictionary<Type, List<Delegate>> _subscribers = new();
        private readonly ReaderWriterLockSlim _lock = new();

        public IDisposable Subscribe<TEvent>(Action<TEvent> handler) where TEvent : class
        {
            if (handler == null)
                throw new ArgumentNullException(nameof(handler));

            _lock.EnterWriteLock();
            try
            {
                var eventType = typeof(TEvent);
                if (!_subscribers.ContainsKey(eventType))
                {
                    _subscribers[eventType] = new List<Delegate>();
                }

                _subscribers[eventType].Add(handler);

                return new Subscription<TEvent>(this, handler);
            }
            finally
            {
                _lock.ExitWriteLock();
            }
        }

        public void Publish<TEvent>(TEvent @event) where TEvent : class
        {
            if (@event == null)
                throw new ArgumentNullException(nameof(@event));

            _lock.EnterReadLock();
            try
            {
                var eventType = typeof(TEvent);
                if (_subscribers.TryGetValue(eventType, out var handlers))
                {
                    foreach (var handler in handlers.ToList())
                    {
                        try
                        {
                            ((Action<TEvent>)handler)(@event);
                        }
                        catch (Exception ex)
                        {
                            // Log but don't throw - other subscribers should still be called
                            System.Diagnostics.Debug.WriteLine($"Error in event handler: {ex.Message}");
                        }
                    }
                }
            }
            finally
            {
                _lock.ExitReadLock();
            }
        }

        public async Task PublishAsync<TEvent>(TEvent @event) where TEvent : class
        {
            if (@event == null)
                throw new ArgumentNullException(nameof(@event));

            _lock.EnterReadLock();
            try
            {
                var eventType = typeof(TEvent);
                if (_subscribers.TryGetValue(eventType, out var handlers))
                {
                    var tasks = new List<Task>();
                    foreach (var handler in handlers.ToList())
                    {
                        tasks.Add(Task.Run(() =>
                        {
                            try
                            {
                                ((Action<TEvent>)handler)(@event);
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine($"Error in async event handler: {ex.Message}");
                            }
                        }));
                    }

                    await Task.WhenAll(tasks);
                }
            }
            finally
            {
                _lock.ExitReadLock();
            }
        }

        public int GetSubscriberCount<TEvent>() where TEvent : class
        {
            _lock.EnterReadLock();
            try
            {
                var eventType = typeof(TEvent);
                return _subscribers.TryGetValue(eventType, out var handlers) ? handlers.Count : 0;
            }
            finally
            {
                _lock.ExitReadLock();
            }
        }

        public void Clear()
        {
            _lock.EnterWriteLock();
            try
            {
                _subscribers.Clear();
            }
            finally
            {
                _lock.ExitWriteLock();
            }
        }

        private class Subscription<TEvent> : IDisposable where TEvent : class
        {
            private readonly DefaultEventBus _bus;
            private readonly Action<TEvent> _handler;
            private bool _disposed;

            public Subscription(DefaultEventBus bus, Action<TEvent> handler)
            {
                _bus = bus;
                _handler = handler;
            }

            public void Dispose()
            {
                if (_disposed)
                    return;

                _bus._lock.EnterWriteLock();
                try
                {
                    var eventType = typeof(TEvent);
                    if (_bus._subscribers.TryGetValue(eventType, out var handlers))
                    {
                        handlers.Remove(_handler);
                        if (handlers.Count == 0)
                        {
                            _bus._subscribers.Remove(eventType);
                        }
                    }
                }
                finally
                {
                    _bus._lock.ExitWriteLock();
                }

                _disposed = true;
            }
        }
    }

    // ============================================================================
    // Domain Events
    // ============================================================================

    /// <summary>
    /// Event: Model loaded successfully
    /// </summary>
    public class ModelLoadedEvent : DomainEvent
    {
        public string ModelId { get; set; }
        public string ModelName { get; set; }
        public string SlotId { get; set; }
        public long LoadTimeMs { get; set; }
    }

    /// <summary>
    /// Event: Model loading failed
    /// </summary>
    public class ModelLoadFailedEvent : DomainEvent
    {
        public string ModelId { get; set; }
        public string SlotId { get; set; }
        public string ErrorMessage { get; set; }
    }

    /// <summary>
    /// Event: Agent task started
    /// </summary>
    public class AgentTaskStartedEvent : DomainEvent
    {
        public string TaskId { get; set; }
        public string AgentName { get; set; }
        public string TaskDescription { get; set; }
    }

    /// <summary>
    /// Event: Agent task completed
    /// </summary>
    public class AgentTaskCompletedEvent : DomainEvent
    {
        public string TaskId { get; set; }
        public string AgentName { get; set; }
        public string Result { get; set; }
        public long ExecutionTimeMs { get; set; }
        public bool Success { get; set; }
    }

    /// <summary>
    /// Event: Chat message received
    /// </summary>
    public class ChatMessageReceivedEvent : DomainEvent
    {
        public string MessageId { get; set; }
        public string Role { get; set; }
        public string Content { get; set; }
        public string Model { get; set; }
    }

    /// <summary>
    /// Event: Configuration changed
    /// </summary>
    public class ConfigurationChangedEvent : DomainEvent
    {
        public string ConfigKey { get; set; }
        public object OldValue { get; set; }
        public object NewValue { get; set; }
    }

    /// <summary>
    /// Event: Slot status changed
    /// </summary>
    public class SlotStatusChangedEvent : DomainEvent
    {
        public string SlotId { get; set; }
        public string OldStatus { get; set; }
        public string NewStatus { get; set; }
        public string ModelId { get; set; }
    }

    /// <summary>
    /// Event: System error occurred
    /// </summary>
    public class SystemErrorEvent : DomainEvent
    {
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public string StackTrace { get; set; }
        public string Component { get; set; }
    }
}
