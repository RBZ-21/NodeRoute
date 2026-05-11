import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { useAIChat, type ChatMessage } from '../../hooks/useAI';

export function AIAskBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const chat = useAIChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, chat.isPending]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  async function send() {
    const message = input.trim();
    if (!message || chat.isPending) return;
    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: message };
    const currentHistory = [...history, userMsg];
    setHistory(currentHistory);
    try {
      const result = await chat.mutateAsync({ message, history });
      setHistory((h) => [...h, { role: 'assistant', content: result.reply }]);
    } catch {
      setHistory((h) => [...h, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="flex h-[440px] w-80 sm:w-96 flex-col rounded-xl border border-border bg-background shadow-2xl">
          <div className="flex items-start justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">✦ AI Assistant</p>
              <p className="text-xs text-muted-foreground">Ask about orders, inventory, or customers</p>
            </div>
            <div className="flex items-center gap-1.5">
              {history.length > 0 && (
                <button
                  onClick={() => setHistory([])}
                  className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  title="Clear conversation"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close AI chat"
              >
                ✕
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {history.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="max-w-[200px] text-center text-xs text-muted-foreground">
                  Ask me anything about your operations — inventory levels, orders, customers, or deliveries.
                </p>
              </div>
            )}
            {history.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chat.isPending && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground animate-pulse">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border p-2">
            <div className="flex gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask a question…"
                disabled={chat.isPending}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <Button size="sm" onClick={() => void send()} disabled={!input.trim() || chat.isPending}>
                Send
              </Button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Open AI Assistant"
        title="AI Assistant"
      >
        <span className="text-xl">✦</span>
      </button>
    </div>
  );
}
