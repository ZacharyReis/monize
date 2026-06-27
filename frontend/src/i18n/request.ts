import { getRequestConfig } from "next-intl/server";
import { headers, cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  matchAcceptLanguage,
  resolveLocale,
} from "./config";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  // The proxy middleware sets `x-locale` from the cookie or Accept-Language.
  // We re-derive here so server components can also opt in without the proxy
  // (e.g. error pages rendered before middleware).
  const headerStore = await headers();
  const cookieStore = await cookies();

  const fromHeader = headerStore.get(LOCALE_HEADER);
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const fromAccept = matchAcceptLanguage(headerStore.get("accept-language"));

  const locale = resolveLocale(fromHeader ?? fromCookie ?? fromAccept) || DEFAULT_LOCALE;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
