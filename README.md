# Cookie Rejecter

Safari-utvidelse som automatisk avviser alle cookies som ikke er strengt nødvendige – uten at du trenger å trykke på noe.

## Slik virker den

`content.js` kjører på alle sider (og i iframes) og leter etter cookie-bannere i 45 sekunder etter at siden er lastet:

1. **Kjente consent-plattformer** – OneTrust, Cookiebot, Usercentrics, Didomi, Sourcepoint, Quantcast, Google Funding Choices, TrustArc, Consentmanager, Cookie Information, CookieYes, Complianz, iubenda, Klaro, Osano, Termly, CookieFirst, Borlabs, Axeptio, Meta, Shopify, HubSpot m.fl.
2. **Generisk heuristikk** – knapper som «Avvis alle», «Kun nødvendige», «Reject all», «Only necessary», «Alle ablehnen» … men bare når knappen ligger i noe som faktisk ser ut som et cookie-banner (fast posisjonert/dialog + tekst om cookies/samtykke).
3. **To-trinns** – finnes ingen avvis-knapp, åpnes «Innstillinger», alle valgfrie brytere skrus av (nødvendige lar den være), og valget lagres.

Den trykker aldri på «Godta alle».

## Kjøre den

1. Åpne `cookie-rejecter.xcodeproj` i Xcode og trykk ▶︎ (Run) med skjemaet **cookie-rejecter**.
2. I Safari: **Innstillinger → Avansert** → huk av «Vis funksjoner for nettutviklere».
3. **Utvikle → Utvikler­innstillinger → Tillat usignerte utvidelser** (må gjøres på nytt hver gang Safari startes, så lenge appen ikke er signert).
4. **Innstillinger → Utvidelser** → slå på **Cookie Rejecter** og gi tilgang til «Alle nettsteder».

## Popup

Knappen i verktøylinja viser status for siden du er på, en bryter for å pause utvidelsen per nettsted, «Avvis nå», statistikk (bannere avvist, klikk spart, anslått tid spart) og de siste sidene som er avvist.

## Feilsøking

Sett `DEBUG = true` øverst i `content.js` for å se hva den finner i Web Inspector-konsollen.
