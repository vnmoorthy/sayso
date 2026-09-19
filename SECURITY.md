# Security

Sayso executes shell commands on the machine it runs on. Please read this before exposing it beyond `localhost`.

## Model

- **Sandbox:** every tool runs with the `workspace/` directory as its working directory; file tools refuse paths that resolve outside it.
- **Say-so gate:** commands matching destructive patterns (recursive deletes, `sudo`, force pushes, process kills, disk operations, `curl | sh`, paths outside the workspace) are held until the user approves on screen or by voice.
- **Transparency:** every tool call, its streamed output, and its result are sent to the UI as RTVI events. Nothing runs silently.
- **No secrets in the browser:** API keys live only in `server/.env`; the web app never sees them.

The gate is a pattern matcher, not a proof. A determined prompt injection (for example, a fetched web page instructing the agent) could still cause unwanted but non-destructive commands to run inside the workspace. Run Sayso on your own machine, on your own network, with a workspace you don't mind losing.

## Reporting a vulnerability

Email vnarasingamoorthy@gmail.com with a description and reproduction steps. Please don't open a public issue for security reports. You'll get an acknowledgement within 72 hours.
