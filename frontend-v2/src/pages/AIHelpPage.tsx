import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useAIChat, useAIWalkthrough, type ChatMessage } from '../hooks/useAI';

type PanelMode = 'assistant' | 'walkthrough';
type MessageRole = 'user' | 'assistant' | 'system';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
};

const SUGGESTED_PROMPTS = [
  'Summarize today\'s delivery status',
  'Which customers are on credit hold?',
  'Show me low inventory items',
  'What routes are active today?',
  'List overdue invoices',
];

const WALKTHROUGH_FEATURES = [
  'Dashboard',
  'Orders',
  'Purchasing',
  'Inventory',
  'Routes',
  'Invoices',
  'Customer Portal',
  'Planning',
  'Warehouse',
  'Analytics',
];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function AIHelpPage() {
  const [mode, setMode] = useState<PanelMode>('assistant');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi! I can answer live questions or walk your team through specific NodeRoute workflows.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [walkthroughFeature, setWalkthroughFeature] = useState('Orders');
  const [walkthroughQuestion, setWalkthroughQuestion] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chat = useAIChat();
  const walkthrough = useAIWalkthrough();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || chat.isPending) return;
    setInput('');
    setError('');

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    const currentMessages = messages;
    setMessages((prev) => [...prev, userMsg]);

    try {
      const history: ChatMessage[] = currentMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const response = await chat.mutateAsync({
        message: trimmed,
        history,
      });

      const assistantMsg: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.reply?.trim() || '(No response from AI)',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(String((err as Error).message || 'AI request failed'));
    } finally {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function clearChat() {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Chat cleared. Ask a question or switch to walkthrough mode for step-by-step help.',
        timestamp: new Date().toISOString(),
      },
    ]);
    setError('');
  }

  async function generateWalkthrough() {
    if (!walkthroughFeature.trim() || walkthrough.isPending) return;
    setError('');
    try {
      await walkthrough.mutateAsync({
        feature: walkthroughFeature,
        question: walkthroughQuestion.trim() || undefined,
      });
    } catch (err) {
      setError(String((err as Error).message || 'AI walkthrough failed'));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>AI Help Center</CardTitle>
              <CardDescription>Use the assistant for live questions or generate guided walkthroughs for key workflows.</CardDescription>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setMode('assistant')}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${mode === 'assistant' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                AI Assistant
              </button>
              <button
                type="button"
                onClick={() => setMode('walkthrough')}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${mode === 'walkthrough' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Walkthroughs
              </button>
            </div>
          </div>
          {mode === 'walkthrough' ? (
            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feature</span>
                <select
                  value={walkthroughFeature}
                  onChange={(e) => setWalkthroughFeature(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {WALKTHROUGH_FEATURES.map((feature) => (
                    <option key={feature} value={feature}>{feature}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Goal</span>
                <Input
                  placeholder="Example: show a new dispatcher how to recover a failed route"
                  value={walkthroughQuestion}
                  onChange={(e) => setWalkthroughQuestion(e.target.value)}
                />
              </label>
              <div className="flex items-end">
                <Button onClick={() => void generateWalkthrough()} disabled={walkthrough.isPending}>
                  {walkthrough.isPending ? 'Building...' : 'Generate'}
                </Button>
              </div>
            </div>
          ) : null}
        </CardHeader>
      </Card>

      {error ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      {mode === 'assistant' ? (
        <>
          <Card className="flex h-[calc(100vh-18rem)] flex-col overflow-hidden">
            <CardContent className="flex h-full flex-col p-0">
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                        msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`mt-1 text-xs ${msg.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
                {chat.isPending ? (
                  <div className="flex justify-start">
                    <div className="animate-pulse rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">
                      Thinking...
                    </div>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => void sendMessage(prompt)}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs transition-colors hover:bg-muted"
              >
                {prompt}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="flex gap-2 p-3">
              <Input
                ref={inputRef}
                placeholder="Ask anything about your operations..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(input);
                  }
                }}
                disabled={chat.isPending}
                className="flex-1"
              />
              <Button variant="ghost" onClick={clearChat}>Clear</Button>
              <Button onClick={() => void sendMessage(input)} disabled={chat.isPending || !input.trim()}>
                {chat.isPending ? '...' : 'Send'}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{walkthrough.data?.title || `${walkthroughFeature} Walkthrough`}</CardTitle>
              <CardDescription>{walkthrough.data?.summary || 'Generate a guide to get a step-by-step workflow, common tips, and likely gotchas.'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</div>
                <div className="mt-3 space-y-3">
                  {(walkthrough.data?.steps || []).length ? walkthrough.data?.steps.map((step, index) => (
                    <div key={`${step}-${index}`} className="flex gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </div>
                      <p className="text-sm text-foreground">{step}</p>
                    </div>
                  )) : (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      Choose a feature and generate a walkthrough to populate this guide.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Tips</CardTitle>
                <CardDescription>Quick pointers your team can use immediately.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(walkthrough.data?.tips || []).length ? walkthrough.data?.tips.map((tip, index) => (
                  <div key={`${tip}-${index}`} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    {tip}
                  </div>
                )) : (
                  <div className="text-sm text-muted-foreground">Tips will appear here after generation.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Warnings</CardTitle>
                <CardDescription>Operational gotchas to watch for before handoff.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(walkthrough.data?.warnings || []).length ? walkthrough.data?.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {warning}
                  </div>
                )) : (
                  <div className="text-sm text-muted-foreground">Warnings will appear here after generation.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
