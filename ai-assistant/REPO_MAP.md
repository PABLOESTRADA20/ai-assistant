# REPO_MAP — ai-assistant

> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a
> escribir solo si cambia algo. Es un índice de orientación del repo (rutas
> y símbolos) pensado para personas y para futuras herramientas: hoy NINGÚN
> código de la app lo lee — la app consulta `search_code`.

- Ficheros indexados: 130
- De ellos, con símbolos: 99
- Trozos: 829
- Embeddings: `@cf/baai/bge-m3` (1024 dims)

## (raíz)
- `next.config.js` → nextConfig

## app/
- `app/error.tsx` → Error, clearAndReload
- `app/global-error.tsx` → GlobalError
- `app/layout.tsx` → RootLayout, viewport, metadata, BOOT_WATCHDOG
- `app/manifest.ts` → manifest
- `app/page.tsx` → formatRemaining, Home, MemoryInspector

## app/api/auth/
- `app/api/auth/route.ts` → GET

## app/api/brain/search/
- `app/api/brain/search/route.ts` → POST

## app/api/chat/
- `app/api/chat/route.ts` → groqErrorResponse, detail, NO_TOOLS_NOTICE, streamSimple, reserveInputChars, readable, drain, message, POST

## app/api/conversations/
- `app/api/conversations/route.ts` → DEFAULT_MODEL, POST, GET

## app/api/conversations/[id]/
- `app/api/conversations/[id]/route.ts` → PUT, GET, DELETE

## app/api/github/browse/
- `app/api/github/browse/route.ts` → GET

## app/api/github/repos/
- `app/api/github/repos/route.ts` → DELETE, POST, GET

## app/api/memory/
- `app/api/memory/route.ts` → POST, GET

## app/api/memory/[id]/
- `app/api/memory/[id]/route.ts` → PATCH, DELETE

## app/api/memory/consolidate/
- `app/api/memory/consolidate/route.ts` → POST

## app/api/memory/search/
- `app/api/memory/search/route.ts` → POST

## app/api/models/
- `app/api/models/route.ts` → GET

## app/api/notes/
- `app/api/notes/route.ts` → POST, GET

## app/api/notes/[id]/
- `app/api/notes/[id]/route.ts` → GET, PUT, DELETE

## app/api/quota/
- `app/api/quota/route.ts` → GET

## app/api/transcribe/
- `app/api/transcribe/route.ts` → transcribeWithWorkersAI, GROQ_TRANSCRIBE, POST

## app/api/vault/index/
- `app/api/vault/index/route.ts` → GET

## app/api/whatsapp/webhook/
- `app/api/whatsapp/webhook/route.ts` → POST, getOrCreateWhatsAppConversation, GET, WHATSAPP_TOOLS, handleMessages, dynamic

## app/components/
- `app/components/AriaMark.tsx` → Props
- `app/components/ChatContainer.tsx` → ChatContainer, Props
- `app/components/ChatInput.tsx` → ChatInput, Props
- `app/components/CodeHighlighter.tsx` → CodeHighlighter, Props
- `app/components/GithubRepos.tsx` → GithubRepos, Repo
- `app/components/InstallButton.tsx` → InstallButton, BeforeInstallPromptEvent, detectPlatform, readCaptured
- `app/components/LoginScreen.tsx` → LoginScreen, Props
- `app/components/MemoryInspector.tsx` → MemoryInspector, StatChip, TYPE_LABELS
- `app/components/MessageBubble.tsx` → CopyButton, CodeBlock, CodeHighlighter, SpeakButton, MessageBubble
- `app/components/ModelSelector.tsx` → ModelSelector, Props
- `app/components/NeuralNetwork.tsx` → NeuralNetwork, Props
- `app/components/NotesPanel.tsx` → NotesPanel, isEditing, Note, noteToMarkdown
- `app/components/PanelLoading.tsx` → PanelLoading
- `app/components/QuotaBadge.tsx` → QuotaBadge
- `app/components/ServiceWorkerRegister.tsx` → ServiceWorkerRegister
- `app/components/SidePanel.tsx` → inputStyle, SidePanel
- `app/components/Sidebar.tsx` → timeAgo, Sidebar, Props
- `app/components/SourceChips.tsx` → SourceChip, KIND_META, formatScore, SourceChips
- `app/components/ToolCard.tsx` → ToolCard, TOOL_ICONS, formatArgs, formatResult
- `app/components/TypingIndicator.tsx` → TypingIndicator
- `app/components/WelcomeScreen.tsx` → WelcomeScreen, suggestions, Props

## app/components/scene/
- `app/components/scene/AriaScene.tsx` → AriaScene, AriaSceneProps, ASSEMBLE_SECONDS
- `app/components/scene/CountachViewer.tsx` → CountachViewer, CountachViewerProps, AriaScene

## app/components/scene/car/
- `app/components/scene/car/current-car.ts` → buildCar, CarMaterials
- `app/components/scene/car/lp5000.ts` → bakedGeometry, Lp5000Materials, CarPart, WHEELS, addArc, buildShell, buildFlare, buildQuad, mergeChildrenByMaterial, buildLp5000
- `app/components/scene/car/utils.ts` → collectStats, disposeObject3D, MATERIAL_TEXTURE_KEYS, CarStats

## app/hooks/
- `app/hooks/useEscapeToClose.ts` → useEscapeToClose
- `app/hooks/usePausableInterval.ts` → usePausableInterval
- `app/hooks/useQuota.ts` → useQuota
- `app/hooks/useTTS.ts` → pickSpanishVoice, useTTS, stripMarkdown
- `app/hooks/useVoiceInput.ts` → useVoiceInput, pickAudioMime, VoiceState, Options, SpeechRecognitionLike

## app/lib/
- `app/lib/api.ts` → RouteContext, withAuth, jsonError, readJson
- `app/lib/aria-core.ts` → WANTS_CURRENT, buildAriaContext, AriaContext, rememberTurn, MIN_COMPACT_MESSAGES, generateSummary, selectTools, MEMORY_MAX_LINES, RX_NOTE_MENTION, RX_WRITE_VERB, RX_MATH, RX_GITHUB_WRITE, RX_CODE_SEARCH, RX_CODE_REVIEW, TOOL_GROUPS, LOOKS_LIKE_ORDER, MODEL_CONFIG, GroqModelConfig, SYSTEM_PROMPT, MemoryLine, wantsWebSearch, GROQ_API, trimMemoryLine, composeMemoryBlock, buildContextMessages, compactConversation, planCompaction, CompactionPlan
- `app/lib/aria-reply.ts` → generateTextReply, TextReplyOptions, drainToText
- `app/lib/auth-client.ts` → TOKEN_KEY, authHeaders, setToken, fetchAuthRequired, fetchWithTimeout, getToken, apiFetch, verifyToken
- `app/lib/auth.ts` → extractToken, getAccessToken, isAuthorized, requireAuth, safeEqual
- `app/lib/background.ts` → registerBackground
- `app/lib/base64.ts` → decodeBase64, encodeBase64
- `app/lib/brain.ts` → mirrorNoteToMemory, RANK_BOOST_MAX, orFuse, lexicalSim, normalizeLexical, labelHit, DEDUPE_JACCARD, contentTokens, jaccard, dedupeHits, BrainKind, BrainHit, BrainSearchOptions, rankBoost, Candidate, MemoryRow, safeQuery, vaultCandidate, memoryHit, searchBrain, NOTE_TAG_PREFIX, removeMirroredNote
- `app/lib/changelog.ts` → latestChange, countRecentChanges, jsonParam, toRecord, ChangeRecord, ChangeEntity, getChange, recordChange, markReverted
- `app/lib/chat-client.ts` → streamChat, MODEL_FALLBACK_ORDER, UnauthorizedError, StreamChatOptions, StreamChatResult, isRetryable
- `app/lib/chat-draft.ts` → loadDraft, DRAFT_PREFIX, draftKey, defaultStorage, saveDraft
- `app/lib/code-index.ts` → braceDelta, CODE_INDEX_EXTENSIONS, CODE_SKIP_DIRS, CodeChunkKind, CodeChunkInput, CodeSearchOptions, LANG_BY_EXT, langFromPath, isIndexedFile, hashContent
- `app/lib/context-info.ts` → contextUsagePercent, formatContextUsage
- `app/lib/download.ts` → downloadBlob
- `app/lib/email.ts` → RESEND_API, sendEmail, emailAllowedRecipients
- `app/lib/embeddings.ts` → semanticSearchDb, reindexVaultEmbeddings, upsertNote, MAX_EMBED_CHARS, matchSnippet
- `app/lib/error-message.ts` → ERROR_MESSAGE_PREFIX
- `app/lib/format.ts` → formatCompactNumber, fmtDate
- `app/lib/github.ts` → fixAttemptsKey, describeError, ghFetch, recordFixAttempt, applyTextPatches, applyPatch, GithubCheckRunsInput, GhCheckRun, clip, getCheckRuns, repoOverview, listFiles, readFile, readFileByLines, listIssues, GithubRepoSummary, normalizeGithubUser, mapRepoSummaries, listMyRepos, removeRepo, cleanRepoPath, getFixAttempts, GithubApplyPatchInput, createPullRequest, GithubPatchOp, GITHUB_API, GITHUB_LIMITS, MAX_FIX_ATTEMPTS, parseRepo, getRepos, saveRepos, addRepo, encodeBase64, branchSlug
- `app/lib/llm-embed.ts` → localEmbed, viaBinding, embeddingCacheSet, embeddingCacheGet, hashEmbedText, MODEL, viaRest, embed
- `app/lib/local-agent.ts` → agentToken, openAppLocally, LocalAgentResult, checkLocalAgent, headers, saveLocalToken
- `app/lib/memory-extract.ts` → heuristicExtract, sanitizeJson, SYSTEM_PROMPT, GROQ_API, extractMemories, sanitizeExtracted
- `app/lib/memory.ts` → getMemoryStats, updateWorkingMemory, getContext, setContext, maybeConsolidate, MEMORY_TYPES, StoredMemory, toStored, getMemoryById, findMemoryById, createMemory, MemoryUpdate, updateMemory, searchSemanticMemories, MemoryFilters, searchMemories, reinforceMemories, ConsolidateOptions, consolidateMemories, recordEpisode
- `app/lib/notes.ts` → NoteRecord, tagsJson, deleteNote, getNote, updateNote, saveNote, findNote, listNotes, parseTags, toRecord
- `app/lib/num.ts` → round01, round3, clamp01
- `app/lib/persist-messages.ts` → hydrateMessages, persistMessages, MessageInput
- `app/lib/prisma.ts` → createClient, AdapterFactory, prisma, getPrisma, globalForPrisma, currentRequestContext, RequestContext
- `app/lib/providers.ts` → catalogWithAvailability, RESERVE_MODEL, MODEL_CATALOG, OPENROUTER, GEMINI, WORKERS_AI, Provider, isModelAvailable, ProviderId, groqChatModels
- `app/lib/quota-info.ts` → formatHourMinute, groqStatusLabel, formatNeuronsRemaining, quotaTooltip
- `app/lib/quota.ts` → estimateEmbeddingNeurons, firstAvailableGroqModel, getFallbackBudget, markGroqQuota, modelQuotaUntil, getQuotaMap, writeQuota, readQuota, estimateNeurons, pruneQuotaMap, parseResetWindow, untilFromError, nextMidnightUtc, FALLBACK_NEURON_BUDGET, GROQ_QUOTA_KEY, FallbackBudget, latestGroqQuotaUntil, fallbackBudgetLeft, chargeEmbedding, chargeFallback
- `app/lib/rate-limit.ts` → rateLimit, RateLimitBinding
- `app/lib/sources.ts` → toSourceRefs, sourceTitle
- `app/lib/sse.ts` → openAiDelta, readSseLines
- `app/lib/store.ts` → getConversations, deleteConversation, updateConversation, createConversation
- `app/lib/tokens.ts` → estimateTokens, CHARS_PER_TOKEN, estimateMessagesTokens, DEFAULT_CONTEXT_BUDGET
- `app/lib/tools.ts` → callGroqWithTools, sendEmailTool, githubRepoOverview, githubListFiles, GROQ_API, bodyModel, groqFetch, TOOL_DEFINITIONS, githubReadFile, githubListIssues, executeToolCall, openApp, githubCreatePullRequest, githubApplyPatch, githubGetCheckRuns, NOTE_READ_MAX, saveCloudNote, listCloudNotes, readCloudNote, memorySnapshot, semanticSearchVault, updateMemoryTool, updateCloudNoteTool, recallMemory, revertChangeTool, getWeather, searchCodeTool, MATH_CONSTANTS, MATH_FUNCTIONS, MathParser, calculate, getTime, webSearch, searchVault, readNote, saveNote
- `app/lib/truncate.ts` → TextWindow, stubToolResult, sliceWindow, normalizeOffset
- `app/lib/vault-index.ts` → buildIndex, getVaultIndex, searchVaultIndex, isIndexFresh, semanticSearch, INDEX_FILE
- `app/lib/web-search.ts` → DISAMBIGUATION, wikiSearch, subjectOf, splitQualifier, searchWikipedia, officialVersion, StackExchange, stackOverflowThrottled, searchStackOverflow, HnAlgolia, releaseNotes, RELEASE_NOISE, searchHackerNews, MdnSearch, searchMdn, EolCatalog, EolDetail, VERSION_INTENT, OFFICIAL_VERSION_SOURCES, searchVersions, RELEASE_SOURCES, topSections, searchReleases, FIRECRAWL_ENDPOINT, NEWS_INTENT, looksSpanish, FirecrawlResponse, searchFirecrawl, CODE_SIGNALS, WEB_SIGNALS, getCachedJson, getJson, cache, USER_AGENT, WebSearchOutcome, decodeEntities, STOPWORDS, entityCandidates, SOURCES, filterRelevant, searchWeb, recentSearches, RELEASE_INTENT
- `app/lib/whatsapp.ts` → markWhatsAppRead, GRAPH_VERSION, allowedNumbers, parseIncoming, chunkText, markdownToWhatsApp, safeEqualHex, verifyMetaSignature, sendWhatsAppText
- `app/lib/workers-ai.ts` → AiBinding, LT, ThinkFilter, normalizeToOpenAiSse, workersAiChatStream
- `app/lib/zip.ts` → crc32, createZip, safeFileName, getCrcTable, encoder

## app/types/
- `app/types/index.ts` → ContextInfo, AVAILABLE_MODELS, Message, AIModel, MemoryRecord, SourceRef, QuotaInfo

## local-agent/
- `local-agent/aria-local-agent.mjs` → server, send, readBody, __dirname, loadEnvFile, TOKEN_FILE, TOKEN, APP_ALIASES, resolveTarget, launch, isOriginAllowed, corsHeaders
