// ====================================
// 👤 Dedicated Manager Page
// ====================================

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { UserCheck, Send, MessageSquare, Phone, Mail, Clock, Star } from "lucide-react";

interface Manager {
  uuid: string;
  name: string;
  email: string;
  phone: string | null;
  photo_url: string | null;
  specialization: string | null;
  bio: string | null;
  availability_hours: string | null;
  assigned_at: string;
}

interface Message {
  uuid: string;
  direction: "inbound" | "outbound";
  subject: string;
  body: string;
  sender_email: string;
  is_read: boolean;
  created_at: string;
}

export default function DedicatedManager() {
  const { toast } = useToast();
  const [manager, setManager] = useState<Manager | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [noManager, setNoManager] = useState(false);

  const [newMessage, setNewMessage] = useState({ subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [mgrRes, msgRes] = await Promise.all([
        apiClient.authenticatedFetch("/v2/manager"),
        apiClient.authenticatedFetch("/v2/manager/messages"),
      ]);
      if (mgrRes.ok) {
        const d = await mgrRes.json();
        if (d.manager) {
          setManager(d.manager);
        } else {
          setNoManager(true);
        }
      } else if (mgrRes.status === 404) {
        setNoManager(true);
      }
      if (msgRes.ok) {
        const d = await msgRes.json();
        setMessages(d.messages || []);
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const requestManager = async () => {
    try {
      const res = await apiClient.authenticatedFetch("/v2/manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_specialization: "general" }),
      });
      if (res.ok) {
        toast({ title: "Žádost odeslána", description: "Manažer bude přiřazen co nejdříve" });
        fetchData();
        setNoManager(false);
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  const sendMessage = async () => {
    if (!newMessage.subject || !newMessage.body) {
      toast({ title: "Vyplňte předmět a zprávu", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await apiClient.authenticatedFetch("/v2/manager/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMessage),
      });
      if (res.ok) {
        toast({ title: "Zpráva odeslána" });
        setNewMessage({ subject: "", body: "" });
        fetchData();
      } else {
        const d = await res.json();
        toast({ title: "Chyba", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const sendReply = async (messageUuid: string) => {
    if (!replyBody) return;
    try {
      const res = await apiClient.authenticatedFetch("/v2/manager/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_uuid: messageUuid, body: replyBody }),
      });
      if (res.ok) {
        toast({ title: "Odpověď odeslána" });
        setReplyTo(null);
        setReplyBody("");
        fetchData();
      }
    } catch {
      toast({ title: "Chyba", variant: "destructive" });
    }
  };

  if (loading) return <div className="p-6 text-center text-muted-foreground">Načítání...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><UserCheck className="h-6 w-6" /> Dedikovaný manažer</h1>
        <p className="text-muted-foreground mt-1">Váš osobní kontakt pro řešení čehokoli</p>
      </div>

      {/* No manager state */}
      {noManager && !manager && (
        <div className="text-center py-12 border rounded-lg space-y-4">
          <UserCheck className="h-16 w-16 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-medium">Zatím nemáte přiřazeného manažera</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            S tarifem Enterprise získáte dedikovaného account manažera, který vám pomůže se vším od nastavení po složité payroll otázky.
          </p>
          <Button onClick={requestManager} size="lg">
            <Star className="h-4 w-4 mr-2" /> Požádat o manažera
          </Button>
        </div>
      )}

      {/* Manager info card */}
      {manager && (
        <div className="border rounded-lg p-6">
          <div className="flex items-start gap-4">
            {manager.photo_url ? (
              <img src={manager.photo_url} alt={manager.name} className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                {manager.name.split(" ").map(n => n[0]).join("")}
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-bold">{manager.name}</h2>
              {manager.specialization && <p className="text-sm text-muted-foreground">{manager.specialization}</p>}
              {manager.bio && <p className="text-sm mt-2">{manager.bio}</p>}
              <div className="flex flex-wrap gap-4 mt-3">
                <a href={`mailto:${manager.email}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
                  <Mail className="h-4 w-4" /> {manager.email}
                </a>
                {manager.phone && (
                  <a href={`tel:${manager.phone}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
                    <Phone className="h-4 w-4" /> {manager.phone}
                  </a>
                )}
                {manager.availability_hours && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" /> {manager.availability_hours}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Přiřazen od {new Date(manager.assigned_at).toLocaleDateString("cs-CZ")}</p>
            </div>
          </div>
        </div>
      )}

      {/* New message */}
      {manager && (
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-medium flex items-center gap-2"><Send className="h-4 w-4" /> Nová zpráva</h3>
          <Input value={newMessage.subject} onChange={e => setNewMessage(prev => ({ ...prev, subject: e.target.value }))} placeholder="Předmět" />
          <textarea
            className="w-full h-24 border rounded-md px-3 py-2 text-sm"
            value={newMessage.body}
            onChange={e => setNewMessage(prev => ({ ...prev, body: e.target.value }))}
            placeholder="Vaše zpráva..."
          />
          <Button onClick={sendMessage} disabled={sending || !newMessage.subject || !newMessage.body}>
            <Send className="h-4 w-4 mr-2" /> {sending ? "Odesílám..." : "Odeslat"}
          </Button>
        </div>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Zprávy ({messages.length})</h3>
          <div className="space-y-3">
            {messages.map(m => (
              <div key={m.uuid} className={`border rounded-lg p-4 ${m.direction === "outbound" ? "border-l-4 border-l-primary" : "border-l-4 border-l-green-500"} ${!m.is_read && m.direction === "outbound" ? "bg-blue-50/50" : ""}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${m.direction === "inbound" ? "bg-primary/10 text-primary" : "bg-green-100 text-green-800"}`}>
                        {m.direction === "inbound" ? "Vy" : "Manažer"}
                      </span>
                      <span className="font-medium text-sm">{m.subject}</span>
                      {!m.is_read && m.direction === "outbound" && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                    </div>
                    <p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.created_at).toLocaleString("cs-CZ")}</span>
                </div>

                {m.direction === "outbound" && (
                  <div className="mt-2">
                    {replyTo === m.uuid ? (
                      <div className="space-y-2">
                        <textarea className="w-full h-16 border rounded-md px-3 py-2 text-sm" value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Vaše odpověď..." />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => sendReply(m.uuid)} disabled={!replyBody}>Odpovědět</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setReplyTo(null); setReplyBody(""); }}>Zrušit</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setReplyTo(m.uuid)}>Odpovědět</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
