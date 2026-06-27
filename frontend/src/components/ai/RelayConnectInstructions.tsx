'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import toast from 'react-hot-toast';

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('ai');
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        toast.success(t('relay.copied'));
      }}
      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
    >
      {t('relay.copy')}
    </button>
  );
}

function CodeBlock({ value, wrap }: { value: string; wrap?: boolean }) {
  return (
    <code
      className={`block overflow-x-auto rounded bg-gray-100 dark:bg-gray-900 p-2 font-mono text-[11px] ${
        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
      }`}
    >
      {value}
    </code>
  );
}

/**
 * The "how to connect your MCP agent" steps, shared by the chat tunnel
 * indicator and the MCP Relay provider modal. Covers Claude (with the
 * --allowedTools flag so it doesn't prompt for every tool call) and Codex
 * (config.toml with auto tool approval). Reads the host from the browser, so
 * it's only rendered client-side after a user action.
 */
export function RelayConnectInstructions() {
  const t = useTranslations('ai');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const mcpUrl = `${origin}/api/v1/mcp`;
  const mcpCommand = `claude mcp add --transport http monize ${mcpUrl} --header "Authorization: Bearer <your-token>"`;
  const claudeRun = 'claude --allowedTools "mcp__monize__*"';
  const codexToml = `[mcp_servers.monize]
url = "${mcpUrl}"
bearer_token_env_var = "MONIZE_TOKEN"
default_tools_approval_mode = "auto"`;
  const loopPrompt = t('relay.loopPrompt');

  return (
    <div className="space-y-3 text-xs text-gray-600 dark:text-gray-300">
      <p>{t('relay.helpIntro')}</p>

      <div>
        <div className="font-medium mb-1">{t('relay.step1')}</div>
        <p className="text-gray-500 dark:text-gray-500">
          {t.rich('relay.tokenStep', {
            link: (chunks) => (
              <Link
                href="/settings#api-access"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>

      {/* Claude */}
      <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-2">
        <div className="font-semibold text-gray-700 dark:text-gray-200">
          {t('relay.claudeHeading')}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">{t('relay.step2')}</span>
            <CopyButton value={mcpCommand} />
          </div>
          <CodeBlock value={mcpCommand} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span>{t('relay.allowToolsNote')}</span>
            <CopyButton value={claudeRun} />
          </div>
          <CodeBlock value={claudeRun} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">{t('relay.step3')}</span>
            <CopyButton value={loopPrompt} />
          </div>
          <CodeBlock value={loopPrompt} wrap />
        </div>
      </div>

      {/* Codex */}
      <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-2">
        <div className="font-semibold text-gray-700 dark:text-gray-200">
          {t('relay.codexHeading')}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span>{t('relay.codexNote')}</span>
            <CopyButton value={codexToml} />
          </div>
          <CodeBlock value={codexToml} />
        </div>
      </div>
    </div>
  );
}
