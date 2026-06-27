# Polish financial terminology glossary

Canonical Polish terms for Monize's UI translation (`messages/pl/*.json`). The
goal is consistency across every namespace: the same English concept must map to
the same Polish word everywhere.

Primary source: the official **GnuCash Polish glossary** (`po/glossary/pl.po`,
`glossary-1/pl.tbx`). Where GnuCash's choice does not fit a modern personal-
finance app, the deviation is noted with a rationale.

| English | Polish (canonical) | Notes |
|---|---|---|
| account | konto | |
| transaction | transakcja | |
| transfer (between accounts) | przelew | bank/account transfer |
| transfer (of securities) | przeniesienie | `transfer_in/out` of holdings -- NOT "przelew" |
| deposit | wpłata | |
| withdrawal | wypłata | |
| balance | saldo | "opening balance" = "bilans otwarcia" |
| income | przychód (l. mn. przychody) | preferred over "dochód"; matches MS Money PL. Keep "podatek dochodowy" for income tax |
| expense | wydatek (l. mn. wydatki) | preferred over "koszt" for personal-finance spending |
| category | kategoria | |
| payee | odbiorca | **deviates** from GnuCash ("wierzyciel" = creditor); "odbiorca" is the correct payee semantics and matches modern apps |
| budget | budżet | |
| asset | aktywa | |
| liability | zobowiązanie (l. mn. zobowiązania) | |
| equity | kapitał własny | |
| net worth | wartość netto | |
| currency | waluta | |
| exchange rate | kurs wymiany | |
| exchange (market) | giełda | |
| security | papier wartościowy (l. mn. papiery wartościowe) | |
| stock / share | akcja / udział | holdings counts use "udziały" for consistency with existing strings |
| holding (portfolio position) | pozycja | |
| dividend | dywidenda | |
| interest | odsetki | |
| principal (loan) | kapitał | |
| portfolio | portfel | GnuCash: "portfel inwestycji" |
| gain | zysk | "capital gains" = "zyski kapitałowe" |
| loss | strata | |
| return (investment) | zwrot | "annualized return" = "zwrot roczny" |
| yield | rentowność | "portfolio yield" = "rentowność portfela" |
| volatility | zmienność | |
| reconcile | uzgodnij / uzgadnianie | GnuCash: "uzgodnij"; NOT "rozliczanie" (settlement) |
| reconciled | uzgodniona | |
| amount | kwota | |
| memo / note | notatka | |
| tag | tag | |
| invoice | faktura | |
| bill | rachunek | |
| loan | pożyczka | |
| mortgage | hipoteka / kredyt hipoteczny | |
| tax | podatek | "income tax" = "podatek dochodowy" |

## UI register

Informal-neutral imperative for actions: "Zapisz", "Anuluj", "Usuń", "Edytuj",
"Utwórz", "Konfiguruj". Prefer the verb form over the noun form for buttons
(e.g. "Edytuj", not "Edycja"). Do not translate brand names (Monize),
currency/ticker codes, or technical identifiers (env var names, MSN, ETF).

## Plural forms

Polish has four CLDR plural categories. Count strings use proper ICU `plural`
blocks rather than a single genitive form, so "1 transakcja" / "2 transakcje" /
"5 transakcji" all read correctly:

    {count, plural, one {# transakcja} few {# transakcje} many {# transakcji} other {# transakcji}}

- `one` -- n = 1
- `few` -- n in 2..4 (excluding 12..14): "konta", "transakcje"
- `many` -- 0, 5..21, ...: "kont", "transakcji"
- `other` -- fractional values (genitive singular)
