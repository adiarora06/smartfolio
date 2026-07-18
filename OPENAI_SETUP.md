# Using OpenAI with SmartFolio

SmartFolio now supports both **Anthropic Claude** and **OpenAI GPT** models. Pick whichever fits your budget and preference.

---

## Quick Setup

### 1. Get Your OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Sign up / Log in
3. Click **"Create new secret key"**
4. Copy the key (you won't see it again)

### 2. Set Environment Variables

#### Local Development (.env file)
```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
LLM_MODEL=gpt-4o-mini
```

#### Render / Production
Add these to your Render environment variables:
```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
LLM_MODEL=gpt-4o-mini
```

### 3. Restart Backend
```bash
# Local
uvicorn app.main:app --reload

# Render: auto-redeploy after env vars change
```

### 4. Test
```bash
curl http://localhost:8000/health
# Should show: "llm": true, "llmModel": "gpt-4o-mini"
```

---

## Model Comparison

### OpenAI Models

| Model | Speed | Cost | Best For |
|-------|-------|------|----------|
| **gpt-4o** | Slower | ~$15/1M tokens | Complex analysis, highest quality |
| **gpt-4o-mini** ⭐ | Fast | ~$0.15/1M tokens | Great balance; recommended for SmartFolio |
| **gpt-4-turbo** | Medium | ~$10/1M tokens | Older; use gpt-4o instead |

### Anthropic Models

| Model | Speed | Cost | Best For |
|-------|-------|------|----------|
| **claude-opus-4-8** | Slower | ~$3/1M tokens | Best quality analysis |
| **claude-sonnet-5** ⭐ | Fast | ~$3/1M tokens | Good balance |
| **claude-haiku-4-5** | Fastest | ~$0.80/1M tokens | Cost-optimized |

**Recommendation for SmartFolio**: Use `gpt-4o-mini` (OpenAI) or `claude-sonnet-5` (Anthropic).

---

## Configuration Options

### Backend .env

```bash
# Which provider to use
LLM_PROVIDER=openai        # or "anthropic"

# API keys (set one or both for fallback)
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...

# Model selection (depends on provider)
LLM_MODEL=gpt-4o-mini      # For OpenAI
LLM_MODEL=claude-sonnet-5  # For Anthropic

# Request settings
LLM_MAX_TOKENS=1024        # Default: 1024
LLM_TIMEOUT=10             # Seconds (default: 10)
```

---

## Cost Estimation

### OpenAI (gpt-4o-mini)
- **Input**: $0.15 per 1M tokens
- **Output**: $0.60 per 1M tokens
- **SmartFolio usage**: ~500 tokens per memo/advisor request
- **Per request**: ~$0.0003-0.0005 (less than $0.001)
- **Free tier**: $5 initial credit

### Anthropic (claude-sonnet-5)
- **Input**: $3 per 1M tokens
- **Output**: $15 per 1M tokens
- **SmartFolio usage**: ~500 tokens per request
- **Per request**: ~$0.01
- **Free tier**: None, but cheap

**OpenAI is cheaper for SmartFolio's use case.**

---

## Fallback Behavior

If your API key is invalid or the service is down:
1. LLM request fails
2. Deterministic template is returned (still high quality)
3. No data loss, no errors to user

This is by design — SmartFolio works fully offline with cached templates.

---

## Switching Providers

Want to switch from Claude to GPT or vice versa?

```bash
# Update .env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...

# Restart
uvicorn app.main:app --reload
```

Or in Render:
1. Update `LLM_PROVIDER` and `OPENAI_API_KEY` in Environment
2. Service auto-redeploys
3. Health check shows new model in use

---

## Troubleshooting

### "llm": false in /health
- Missing API key for the provider
- Set `OPENAI_API_KEY` if using `LLM_PROVIDER=openai`
- Set `ANTHROPIC_API_KEY` if using `LLM_PROVIDER=anthropic`

### Getting 401 errors in logs
- API key is invalid or expired
- Regenerate from OpenAI dashboard
- Verify no extra spaces in .env

### Responses are slow
- Try faster model: `gpt-4o-mini` (OpenAI) or `claude-haiku-4-5` (Anthropic)
- Increase `LLM_TIMEOUT` if requests are timing out
- Check OpenAI API status: https://status.openai.com

### Too expensive
- Switch to `gpt-4o-mini` (cheapest quality option)
- Or use Anthropic `claude-haiku-4-5` (fastest)
- Disable LLM entirely (use deterministic templates only)

---

## Health Check

```bash
curl http://localhost:8000/health
```

Response:
```json
{
  "status": "ok",
  "service": "smartfolio-api",
  "version": "0.3.0",
  "liveMarketData": true,
  "marketDataProvider": "alphavantage",
  "llm": true,
  "llmModel": "gpt-4o-mini",
  "database": "sqlite"
}
```

---

## Rate Limits

### OpenAI (Free Trial)
- 3 requests/minute
- $5 credit expires after 3 months

### OpenAI (Paid Account)
- 500 requests/minute initially
- Raises automatically with usage

### Anthropic
- No public rate limits for small usage
- Fair use policy

For SmartFolio, you won't hit these limits unless you have thousands of daily users.

---

## Advanced: Multiple API Keys

You can set both keys and SmartFolio will use whichever provider is configured:

```
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=openai        # Use OpenAI
```

If you want to switch, just change `LLM_PROVIDER`.

---

## Support

- OpenAI Issues: https://help.openai.com
- Anthropic Issues: https://support.anthropic.com
- SmartFolio Issues: See logs with `curl http://localhost:8000/health`
