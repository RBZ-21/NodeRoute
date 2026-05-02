import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { sendWithAuth } from '../lib/api';

type MessageRole = 'user' | 'assistant' | 'system';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
};

type AIChatResponse = {
  reply?: string;
  message?: string;
  content?: string;
  response?: string;
};

const SUGGESTED_PROMPTS = [
  'Summarize today\'s delivery status',
  'Which customers are on credit hold?',
  'Show me low inventory items',
  'What routes are active today?',
  'List overdue invoices',
];

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export function AIHelpPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi! I\'m your NodeRoute AI assistant. Ask me anything about your deliveries, routes, customers, inventory, or invoices.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');
    setError('');

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const payload: Record<string, unknown> = { message: trimmed };
      if (conversationId) payload.conversation_id = conversationId;

      const response = await sendWithAuth<AIChatResponse & { conversation_id?: string }>(
        '/api/ai/chat',
        'POST',
        payload
      );

      const reply = String(
        response.reply ?? response.message ?? response.content ?? response.response ?? ''
      ).trim() || '(No response from AI)';

      if (response.conversation_id) setConversationId(response.conversation_id);

      const assistantMsg: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(String((err as Error).message || 'AI request failed'));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function clearChat() {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Chat cleared. How can I help you?',
        timestamp: new Date().toISOString(),
      },
    ]);
    setConversationId(null);
    setError('');
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-3">
      <Card className="shrink-0">
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <div>
            <CardTitle>AI Assistant</CardTitle>
            <CardDescription>Ask about deliveries, routes, customers, inventory, or invoices.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={clearChat}>Clear chat</Button>
        </CardHeader>
      </Card>

      {error ? (
        <div className="shrink-0 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      {/* Message thread */}
      <Card className="flex-1 overflow-hidden">
        <CardContent className="flex h-full flex-col p-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p className={`mt-1 text-xs ${
                    msg.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'
                  }`}>
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}
            {loading ? (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground animate-pulse">
                  Thinking...
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </CardContent>
      </Card>

      {/* Suggested prompts */}
      <div className="shrink-0 flex flex-wrap gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => void sendMessage(prompt)}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs hover:bg-muted transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input bar */}
      <Card className="shrink-0">
        <CardContent className="flex gap-2 p-3">
          <Input
            ref={inputRef}
            placeholder="Ask anything about your operations..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input); } }}
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={() => void sendMessage(input)} disabled={loading || !input.trim()}>
            {loading ? '...' : 'Send'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
