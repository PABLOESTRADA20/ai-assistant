# REPO_MAP — ai-assistant

> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a
> escribir solo si cambia algo. Es un índice de orientación del repo (rutas
> y símbolos) pensado para personas y para futuras herramientas: hoy NINGÚN
> código de la app lo lee — la app consulta `search_code`.

- Ficheros indexados: 86
- Trozos: 574
- Embeddings: `@cf/baai/bge-m3` (1024 dims)

## app/
- `app/error.tsx` → Error, clearAndReload
- `app/global-error.tsx` → GlobalError
- `app/layout.tsx` → RootLayout, BOOT_WATCHDOG, metadata, viewport

## app/api/auth/
- `app/api/auth/route.ts` → GET

## app/api/brain/search/
- `app/api/brain/search/route.ts` → POST

## app/api/chat/
- `app/api/chat/route.ts` → POST, detail, NO_TOOLS_NOTICE, streamSimple, reserveInputChars, readable, drain, message, groqErrorResponse

## app/api/conversations/
- `app/api/conversations/route.ts` → DEFAULT_MODEL, GET, POST

## app/api/conversations/[id]/
- `app/api/conversations/[id]/route.ts` → GET, PUT, DELETE

## app/api/github/browse/
- `app/api/github/browse/route.ts` → GET

## app/api/github/repos/
- `app/api/github/repos/route.ts` → GET, DELETE, POST

## app/api/memory/
- `app/api/memory/route.ts` → GET, POST

## app/api/memory/[id]/
- `app/api/memory/[id]/route.ts` → PATCH, DELETE

## app/api/memory/consolidate/
- `app/api/memory/consolidate/route.ts` → POST

## app/api/memory/search/
- `app/api/memory/search/route.ts` → POST

## app/api/models/
- `app/api/models/route.ts` → GET

## app/api/notes/
- `app/api/notes/route.ts` → GET, POST

## app/api/notes/[id]/
- `app/api/notes/[id]/route.ts` → DELETE, PUT, GET

## app/api/quota/
- `app/api/quota/route.ts` → GET

## app/api/transcribe/
- `app/api/transcribe/route.ts` → transcribeWithWorkersAI, GROQ_TRANSCRIBE, POST

## app/api/vault/index/
- `app/api/vault/index/route.ts` → GET

## app/api/whatsapp/webhook/
- `app/api/whatsapp/webhook/route.ts` → POST, GET, getOrCreateWhatsAppConversation, handleMessages, WHATSAPP_TOOLS, dynamic

## app/components/
- `app/components/AriaMark.tsx` → Props
- `app/components/ChatContainer.tsx` → ChatContainer, Props
- `app/components/ChatInput.tsx` → ChatInput, Props
- `app/components/CodeHighlighter.tsx` → Props, CodeHighlighter
- `app/components/GithubRepos.tsx` → GithubRepos, Repo
- `app/components/InstallButton.tsx` → readCaptured, BeforeInstallPromptEvent, detectPlatform, InstallButton
- `app/components/LoginScreen.tsx` → LoginScreen, Props
- `app/components/MemoryInspector.tsx` → MemoryInspector, StatChip, TYPE_LABELS
- `app/components/MessageBubble.tsx` → CopyButton, CodeBlock, CodeHighlighter, SpeakButton, MessageBubble
- `app/components/ModelSelector.tsx` → ModelSelector, Props
- `app/components/NeuralNetwork.tsx` → NeuralNetwork, Props
- `app/components/NotesPanel.tsx` → isEditing, Note, noteToMarkdown, NotesPanel
- `app/components/PanelLoading.tsx` → PanelLoading
- `app/components/QuotaBadge.tsx` → QuotaBadge
- `app/components/ServiceWorkerRegister.tsx` → ServiceWorkerRegister
- `app/components/SidePanel.tsx` → inputStyle, SidePanel
- `app/components/Sidebar.tsx` → Sidebar, Props, timeAgo
- `app/components/SourceChips.tsx` → SourceChips, SourceChip, formatScore, KIND_META
- `app/components/ToolCard.tsx` → ToolCard, TOOL_ICONS, formatArgs, formatResult
- `app/components/TypingIndicator.tsx` → TypingIndicator
- `app/components/WelcomeScreen.tsx` → WelcomeScreen, suggestions, Props

## app/components/scene/
- `app/components/scene/AriaScene.tsx` → AriaScene, AriaSceneProps, ASSEMBLE_SECONDS
- `app/components/scene/CountachViewer.tsx` → CountachViewer, AriaScene, CountachViewerProps

## app/components/scene/car/
- `app/components/scene/car/current-car.ts` → buildCar, CarMaterials
- `app/components/scene/car/lp5000.ts` → buildLp5000, Lp5000Materials, WHEELS, addArc, buildShell, CarPart, buildFlare, buildQuad, bakedGeometry, mergeChildrenByMaterial
- `app/components/scene/car/utils.ts` → disposeObject3D, CarStats, collectStats, MATERIAL_TEXTURE_KEYS

## app/hooks/
- `app/hooks/useEscapeToClose.ts` → useEscapeToClose
- `app/hooks/usePausableInterval.ts` → usePausableInterval
- `app/hooks/useQuota.ts` → useQuota
- `app/hooks/useTTS.ts` → pickSpanishVoice, useTTS, stripMarkdown
- `app/hooks/useVoiceInput.ts` → SpeechRecognitionLike, useVoiceInput, VoiceState, pickAudioMime, Options

## app/lib/
- `app/lib/api.ts` → withAuth, RouteContext, readJson, jsonError
- `app/lib/aria-core.ts` → MODEL_CONFIG, trimMemoryLine, MemoryLine, WANTS_CURRENT, wantsWebSearch, TOOL_GROUPS, RX_CODE_REVIEW, RX_CODE_SEARCH, RX_GITHUB_WRITE, RX_MATH, MEMORY_MAX_LINES, selectTools, generateSummary, MIN_COMPACT_MESSAGES, CompactionPlan, planCompaction, compactConversation, buildContextMessages, composeMemoryBlock, rememberTurn, AriaContext, buildAriaContext, SYSTEM_PROMPT, GroqModelConfig, LOOKS_LIKE_ORDER, GROQ_API
- `app/lib/aria-reply.ts` → TextReplyOptions, drainToText, generateTextReply
- `app/lib/auth-client.ts` → apiFetch, fetchAuthRequired, fetchWithTimeout, verifyToken, TOKEN_KEY, getToken, setToken, authHeaders
- `app/lib/auth.ts` → getAccessToken, requireAuth, isAuthorized, safeEqual, extractToken
- `app/lib/background.ts` → registerBackground
- `app/lib/base64.ts` → encodeBase64, decodeBase64
- `app/lib/brain.ts` → memoryHit, RANK_BOOST_MAX, orFuse, lexicalSim, normalizeLexical, labelHit, DEDUPE_JACCARD, contentTokens, jaccard, dedupeHits, BrainKind, BrainHit, BrainSearchOptions, rankBoost, Candidate, MemoryRow, safeQuery, vaultCandidate, searchBrain, NOTE_TAG_PREFIX, removeMirroredNote, mirrorNoteToMemory
- `app/lib/chat-client.ts` → streamChat, MODEL_FALLBACK_ORDER, UnauthorizedError, StreamChatOptions, StreamChatResult, isRetryable
- `app/lib/chat-draft.ts` → draftKey, loadDraft, saveDraft, DRAFT_PREFIX, defaultStorage
- `app/lib/code-index.ts` → CodeChunkKind, CodeChunkInput, CodeSearchOptions, langFromPath, LANG_BY_EXT, isIndexedFile, braceDelta, hashContent, CODE_INDEX_EXTENSIONS, CODE_SKIP_DIRS
- `app/lib/context-info.ts` → contextUsagePercent, formatContextUsage
- `app/lib/download.ts` → downloadBlob
- `app/lib/email.ts` → sendEmail, emailAllowedRecipients, RESEND_API
- `app/lib/embeddings.ts` → reindexVaultEmbeddings, matchSnippet, semanticSearchDb, MAX_EMBED_CHARS, upsertNote
- `app/lib/error-message.ts` → ERROR_MESSAGE_PREFIX
- `app/lib/format.ts` → formatCompactNumber, fmtDate
- `app/lib/github.ts` → readFileByLines, removeRepo, fixAttemptsKey, getFixAttempts, GITHUB_API, GITHUB_LIMITS, MAX_FIX_ATTEMPTS, parseRepo, getRepos, saveRepos, addRepo, recordFixAttempt, ghFetch, describeError, cleanRepoPath, branchSlug, encodeBase64, createPullRequest, GithubPatchOp, GithubApplyPatchInput, applyTextPatches, applyPatch, GithubCheckRunsInput, GhCheckRun, clip, getCheckRuns, repoOverview, listFiles, readFile, listIssues, GithubRepoSummary, normalizeGithubUser, mapRepoSummaries, listMyRepos
- `app/lib/llm-embed.ts` → viaRest, embed, localEmbed, MODEL, hashEmbedText, viaBinding, embeddingCacheSet, embeddingCacheGet
- `app/lib/local-agent.ts` → LocalAgentResult, saveLocalToken, headers, openAppLocally, checkLocalAgent, agentToken
- `app/lib/memory-extract.ts` → SYSTEM_PROMPT, sanitizeJson, extractMemories, heuristicExtract, sanitizeExtracted, GROQ_API
- `app/lib/memory.ts` → maybeConsolidate, ConsolidateOptions, getMemoryById, searchSemanticMemories, MemoryFilters, searchMemories, reinforceMemories, consolidateMemories, getMemoryStats, recordEpisode, updateWorkingMemory, getContext, setContext, MEMORY_TYPES, StoredMemory, toStored, createMemory, MemoryUpdate, updateMemory
- `app/lib/notes.ts` → findNote, saveNote, updateNote, getNote, deleteNote, parseTags, toRecord, tagsJson, listNotes, NoteRecord
- `app/lib/num.ts` → round01, clamp01, round3
- `app/lib/persist-messages.ts` → hydrateMessages, MessageInput, persistMessages
- `app/lib/prisma.ts` → prisma, getPrisma, AdapterFactory, RequestContext, createClient, currentRequestContext, globalForPrisma
- `app/lib/providers.ts` → OPENROUTER, MODEL_CATALOG, RESERVE_MODEL, Provider, WORKERS_AI, GEMINI, catalogWithAvailability, isModelAvailable, ProviderId, groqChatModels
- `app/lib/quota-info.ts` → formatNeuronsRemaining, groqStatusLabel, quotaTooltip, formatHourMinute
- `app/lib/quota.ts` → getFallbackBudget, FallbackBudget, latestGroqQuotaUntil, nextMidnightUtc, untilFromError, parseResetWindow, pruneQuotaMap, estimateNeurons, readQuota, fallbackBudgetLeft, writeQuota, getQuotaMap, modelQuotaUntil, markGroqQuota, firstAvailableGroqModel, chargeFallback, estimateEmbeddingNeurons, chargeEmbedding, GROQ_QUOTA_KEY, FALLBACK_NEURON_BUDGET
- `app/lib/rate-limit.ts` → rateLimit, RateLimitBinding
- `app/lib/sources.ts` → toSourceRefs, sourceTitle
- `app/lib/sse.ts` → openAiDelta, readSseLines
- `app/lib/store.ts` → updateConversation, createConversation, getConversations, deleteConversation
- `app/lib/tokens.ts` → CHARS_PER_TOKEN, DEFAULT_CONTEXT_BUDGET, estimateTokens, estimateMessagesTokens
