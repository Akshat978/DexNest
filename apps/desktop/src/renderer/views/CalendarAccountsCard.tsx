// Connecting Google and Outlook calendars.
//
// Two steps, and they are genuinely separate: registering an app with the
// provider is done once and involves their console; connecting an account is
// done per address and involves a browser. Collapsing them into one button
// would mean the first failure — a missing client ID — arriving in the middle
// of a sign-in, which is the worst place to explain it.

import React, { useCallback, useEffect, useState } from "react";
import { CalendarDays, Link2, RefreshCw, Trash2 } from "lucide-react";

import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ActionButton } from "../components/ui/ActionButton";
import { getBridge } from "../lib/bridge";
import { formatDate } from "../lib/format";

const ACCENT = "#14B8A6";

type ProviderId = "google" | "microsoft";

interface Account {
  id: string;
  provider: ProviderId;
  email: string;
  lastSyncAt: string | null;
  lastError: string | null;
  eventCount: number;
  enabled: boolean;
  /** Whether DexNest holds a token that can change this account's events. */
  canWrite: boolean;
}

const PROVIDER_LABEL: Record<ProviderId, string> = { google: "Google", microsoft: "Outlook" };

export function CalendarAccountsCard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [configured, setConfigured] = useState<Record<ProviderId, boolean>>({ google: false, microsoft: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [setup, setSetup] = useState<ProviderId | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const load = useCallback(async () => {
    const state = await getBridge().getCalendarAccounts();
    setAccounts(state.accounts);
    setConfigured(state.configured);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveApp = async (provider: ProviderId) => {
    setBusy("app");
    setProblem(null);
    try {
      const result = await getBridge().setCalendarApp(provider, clientId, clientSecret || null);
      if (!result.ok) { setProblem(result.error); return; }
      // Cleared immediately: the secret has been handed to the keychain and
      // there is no reason for a copy to stay in a React state tree.
      setClientId("");
      setClientSecret("");
      setSetup(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const connect = async (provider: ProviderId) => {
    setBusy(provider);
    setProblem(null);
    try {
      const result = await getBridge().connectCalendar(provider);
      if (!result.ok) setProblem(result.error);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      setAccounts((await getBridge().syncCalendars()).accounts);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (accountId: string) => {
    setBusy(accountId);
    try {
      setAccounts((await getBridge().disconnectCalendar(accountId)).accounts);
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard accent={ACCENT} hover={false}>
      <SectionTitle
        action={
          accounts.length > 0 ? (
            <button
              type="button"
              onClick={() => void sync()}
              disabled={busy === "sync"}
              className="flex items-center gap-1 text-[10px] text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
            >
              <RefreshCw className="h-3 w-3" />
              {busy === "sync" ? "syncing" : "sync now"}
            </button>
          ) : (
            <StatusChip tone="info">none</StatusChip>
          )
        }
      >
        Calendar accounts
      </SectionTitle>

      {accounts.length === 0 ? (
        <p className="mb-2.5 text-xs text-[#A3A3A3]">
          Connect Google or Outlook and their events appear in Today, here and on your phone.
        </p>
      ) : (
        <div className="mb-3 space-y-2">
          {accounts.map((account) => (
            <div key={account.id} className="glass-card flex items-center gap-2.5 p-2.5">
              <CalendarDays className="h-4 w-4 shrink-0" style={{ color: ACCENT }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-[#F5F5F5]">{account.email}</p>
                <p className="truncate text-[10px] text-[#525252]">
                  {PROVIDER_LABEL[account.provider]} · {account.eventCount} events
                  {account.lastSyncAt ? ` · ${formatDate(account.lastSyncAt)}` : " · never synced"}
                </p>
                {account.lastError ? (
                  <p className="truncate text-[10px] text-[#F59E0B]" title={account.lastError}>{account.lastError}</p>
                ) : null}
                {!account.canWrite && account.provider === "google" ? (
                  // Reconnecting is the whole fix: the stored token was issued
                  // under a read-only grant and no amount of retrying widens
                  // it. Said here rather than at the point of a failed save,
                  // because by then an edit has already been typed out.
                  <button
                    type="button"
                    onClick={() => void connect("google")}
                    disabled={busy === "google"}
                    className="mt-0.5 text-left text-[10px] text-[#14B8A6] underline-offset-2 hover:underline"
                  >
                    {busy === "google" ? "Waiting for browser…" : "Read-only. Reconnect to let DexNest edit this calendar."}
                  </button>
                ) : null}
                {!account.canWrite && account.provider === "microsoft" ? (
                  <p className="text-[10px] text-[#525252]">Read-only. Outlook editing is not built yet.</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void disconnect(account.id)}
                disabled={busy === account.id}
                title="Disconnect"
                aria-label={`Disconnect ${account.email}`}
                className="shrink-0 rounded-md p-1.5 text-[#525252] transition-colors hover:bg-[#1a1a1a] hover:text-[#EF4444]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["google", "microsoft"] as ProviderId[]).map((provider) => (
          configured[provider] ? (
            <ActionButton
              key={provider}
              icon={Link2}
              accent={ACCENT}
              variant="soft"
              disabled={busy === provider}
              onClick={() => void connect(provider)}
            >
              {busy === provider ? "Waiting for browser…" : `Connect ${PROVIDER_LABEL[provider]}`}
            </ActionButton>
          ) : (
            <ActionButton
              key={provider}
              icon={Link2}
              accent={ACCENT}
              variant="ghost"
              onClick={() => setSetup(setup === provider ? null : provider)}
            >
              Set up {PROVIDER_LABEL[provider]}
            </ActionButton>
          )
        ))}
      </div>

      {setup ? (
        <div className="mt-3 space-y-2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-3">
          <p className="text-[11px] text-[#A3A3A3]">
            {setup === "google"
              ? "Google Cloud console → APIs & Services → Credentials → OAuth client ID → Desktop app."
              : "Azure portal → App registrations → New → Mobile and desktop, redirect http://localhost."}
          </p>
          <input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Client ID"
            className="w-full rounded-md border border-[#1f1f1f] bg-[#0d0d0d] px-2.5 py-1.5 font-mono text-[11px] text-[#F5F5F5] placeholder:text-[#525252]"
          />
          {setup === "google" ? (
            <input
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Client secret"
              type="password"
              className="w-full rounded-md border border-[#1f1f1f] bg-[#0d0d0d] px-2.5 py-1.5 font-mono text-[11px] text-[#F5F5F5] placeholder:text-[#525252]"
            />
          ) : null}
          <ActionButton
            icon={Link2}
            accent={ACCENT}
            variant="soft"
            disabled={busy === "app" || !clientId.trim()}
            onClick={() => void saveApp(setup)}
          >
            {busy === "app" ? "Saving…" : "Save"}
          </ActionButton>
          <p className="text-[10px] text-[#525252]">
            Stored encrypted with your Windows account, the same as every other DexNest credential.
          </p>
        </div>
      ) : null}

      {problem ? <p className="mt-2 text-[11px] text-[#EF4444]">{problem}</p> : null}
    </GlassCard>
  );
}
