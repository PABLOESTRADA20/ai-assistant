# REPO_MAP — ai-assistant

> Generado por `npm run db:index-code`. **No editar a mano**: se vuelve a
> escribir solo si cambia algo. Es un índice de orientación del repo (rutas
> y símbolos) pensado para personas y para futuras herramientas: hoy NINGÚN
> código de la app lo lee — la app consulta `search_code`.

- Ficheros indexados: 203
- De ellos, con símbolos: 144
- Trozos: 1229
- Embeddings: `@cf/baai/bge-m3` (1024 dims)

## (raíz)
- `next.config.js` → nextConfig
- `tailwind.config.ts` → config
- `vitest.config.ts` → wasmModuleConvention

## app/
- `app/error.tsx` → clearAndReload, Error
- `app/global-error.tsx` → GlobalError
- `app/layout.tsx` → BOOT_WATCHDOG, viewport, RootLayout, metadata
- `app/manifest.ts` → manifest
- `app/page.tsx` → Home, formatRemaining, MemoryInspector

## app/api/auth/
- `app/api/auth/route.ts` → GET

## app/api/brain/search/
- `app/api/brain/search/route.ts` → POST

## app/api/chat/
- `app/api/chat/route.ts` → drain, groqErrorResponse, POST, detail, NO_TOOLS_NOTICE, streamSimple, reserveInputChars, readable, message

## app/api/conversations/
- `app/api/conversations/route.ts` → GET, DEFAULT_MODEL, POST

## app/api/conversations/[id]/
- `app/api/conversations/[id]/route.ts` → DELETE, GET, PUT

## app/api/github/browse/
- `app/api/github/browse/route.ts` → GET

## app/api/github/repos/
- `app/api/github/repos/route.ts` → POST, DELETE, GET

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
- `app/api/notes/[id]/route.ts` → PUT, DELETE, GET

## app/api/quota/
- `app/api/quota/route.ts` → GET

## app/api/transcribe/
- `app/api/transcribe/route.ts` → transcribeWithWorkersAI, POST, GROQ_TRANSCRIBE

## app/api/vault/index/
- `app/api/vault/index/route.ts` → GET

## app/api/whatsapp/webhook/
- `app/api/whatsapp/webhook/route.ts` → WHATSAPP_TOOLS, dynamic, GET, POST, handleMessages, getOrCreateWhatsAppConversation

## app/components/
- `app/components/AriaMark.tsx` → Props
- `app/components/ChatContainer.tsx` → ChatContainer, Props
- `app/components/ChatInput.tsx` → ChatInput, Props
- `app/components/CodeHighlighter.tsx` → Props, CodeHighlighter
- `app/components/GithubRepos.tsx` → GithubRepos, Repo
- `app/components/InstallButton.tsx` → InstallButton, BeforeInstallPromptEvent, readCaptured, detectPlatform
- `app/components/LoginScreen.tsx` → LoginScreen, Props
- `app/components/MemoryInspector.tsx` → MemoryInspector, StatChip, TYPE_LABELS
- `app/components/MessageBubble.tsx` → CodeBlock, MessageBubble, CodeHighlighter, CopyButton, SpeakButton
- `app/components/ModelSelector.tsx` → Props, ModelSelector
- `app/components/NeuralNetwork.tsx` → NeuralNetwork, Props
- `app/components/NotesPanel.tsx` → isEditing, NotesPanel, noteToMarkdown, Note
- `app/components/PanelLoading.tsx` → PanelLoading
- `app/components/QuotaBadge.tsx` → QuotaBadge
- `app/components/ServiceWorkerRegister.tsx` → ServiceWorkerRegister
- `app/components/SidePanel.tsx` → inputStyle, SidePanel
- `app/components/Sidebar.tsx` → Sidebar, Props, timeAgo
- `app/components/SourceChips.tsx` → SourceChip, KIND_META, formatScore, SourceChips
- `app/components/ToolCard.tsx` → TOOL_ICONS, ToolCard, formatResult, formatArgs
- `app/components/TypingIndicator.tsx` → TypingIndicator
- `app/components/WelcomeScreen.tsx` → suggestions, Props, WelcomeScreen

## app/components/scene/
- `app/components/scene/AriaScene.tsx` → AriaScene, ASSEMBLE_SECONDS, AriaSceneProps
- `app/components/scene/CountachViewer.tsx` → CountachViewer, AriaScene, CountachViewerProps

## app/components/scene/car/
- `app/components/scene/car/current-car.ts` → buildCar, CarMaterials
- `app/components/scene/car/lp5000.ts` → buildLp5000, buildShell, buildQuad, WHEELS, CarPart, Lp5000Materials, addArc, bakedGeometry, mergeChildrenByMaterial, buildFlare
- `app/components/scene/car/utils.ts` → MATERIAL_TEXTURE_KEYS, CarStats, collectStats, disposeObject3D

## app/hooks/
- `app/hooks/useEscapeToClose.ts` → useEscapeToClose
- `app/hooks/usePausableInterval.ts` → usePausableInterval
- `app/hooks/useQuota.ts` → useQuota
- `app/hooks/useTTS.ts` → useTTS, stripMarkdown, pickSpanishVoice
- `app/hooks/useVoiceInput.ts` → Options, SpeechRecognitionLike, useVoiceInput, pickAudioMime, VoiceState

## app/lib/
- `app/lib/api.ts` → jsonError, RouteContext, readJson, withAuth
- `app/lib/aria-core.ts` → trimMemoryLine, wantsWebSearch, TOOL_GROUPS, SYSTEM_PROMPT, GROQ_API, GroqModelConfig, buildAriaContext, RX_GITHUB_WRITE, RX_MATH, AriaContext, rememberTurn, RX_CODE_REVIEW, selectTools, generateSummary, MIN_COMPACT_MESSAGES, CompactionPlan, planCompaction, compactConversation, buildContextMessages, MEMORY_MAX_LINES, MemoryLine, RX_CODE_SEARCH, RX_NOTE_MENTION, WANTS_CURRENT, LOOKS_LIKE_ORDER, composeMemoryBlock, MODEL_CONFIG, RX_WRITE_VERB
- `app/lib/aria-reply.ts` → drainToText, generateTextReply, TextReplyOptions
- `app/lib/auth-client.ts` → setToken, authHeaders, apiFetch, fetchWithTimeout, fetchAuthRequired, verifyToken, getToken, TOKEN_KEY
- `app/lib/auth.ts` → extractToken, safeEqual, requireAuth, getAccessToken, isAuthorized
- `app/lib/background.ts` → registerBackground
- `app/lib/base64.ts` → encodeBase64, decodeBase64
- `app/lib/brain.ts` → orFuse, RANK_BOOST_MAX, lexicalSim, normalizeLexical, labelHit, DEDUPE_JACCARD, contentTokens, jaccard, dedupeHits, BrainKind, BrainHit, BrainSearchOptions, rankBoost, Candidate, MemoryRow, safeQuery, vaultCandidate, memoryHit, searchBrain, NOTE_TAG_PREFIX, removeMirroredNote, mirrorNoteToMemory
- `app/lib/changelog.ts` → jsonParam, countRecentChanges, recordChange, getChange, latestChange, markReverted, ChangeEntity, ChangeRecord, toRecord
- `app/lib/chat-client.ts` → UnauthorizedError, streamChat, isRetryable, StreamChatResult, StreamChatOptions, MODEL_FALLBACK_ORDER
- `app/lib/chat-draft.ts` → loadDraft, saveDraft, DRAFT_PREFIX, draftKey, defaultStorage
- `app/lib/code-index.ts` → LANG_BY_EXT, CodeSearchOptions, braceDelta, hashContent, isIndexedFile, langFromPath, CODE_INDEX_EXTENSIONS, CodeChunkInput, CodeChunkKind, CODE_SKIP_DIRS
- `app/lib/context-info.ts` → formatContextUsage, contextUsagePercent
- `app/lib/download.ts` → downloadBlob
- `app/lib/email.ts` → sendEmail, RESEND_API, emailAllowedRecipients
- `app/lib/embeddings.ts` → needsReindex, ReindexOptions, ReindexResult, upsertNote, MAX_EMBED_CHARS, reindexVaultEmbeddings, matchSnippet, semanticSearchDb
- `app/lib/error-message.ts` → ERROR_MESSAGE_PREFIX
- `app/lib/format.ts` → fmtDate, formatCompactNumber
- `app/lib/git-common.ts` → PATCH_MAX_REMOVED_LINES, PATCH_SEARCH_MAX_CHARS
- `app/lib/git-hosts.ts` → platformStatuses, PlatformStatus, platformToken, repoKey, parseRepoRef, platformFromHost, RepoRef, GIT_HOSTS, GitHost, GitPlatform
- `app/lib/git.ts` → gitMergePullRequest, gitGetCheckRuns, gitDeleteFiles, gitApplyPatch, gitCreatePullRequest, gitListFiles, gitListIssues, notImplemented, invalid, resolve, GitChange, gitRepoOverview, gitReadFile, gitVerifyRepo
- `app/lib/github.ts` → applyPatch, GithubApplyPatchInput, GithubPatchOp, createPullRequest, listFiles, describeError, ghFetch, recordFixAttempt, getFixAttempts, fixAttemptsKey, removeRepo, addRepo, saveRepos, getRepos, parseRepo, githubAutoMergeEnabled, MAX_FIX_ATTEMPTS, GITHUB_LIMITS, verifyRepo, GITHUB_API, readFile, listMyRepos, listIssues, GithubRepoSummary, normalizeGithubUser, mapRepoSummaries, GithubCheckRunsInput, mergePullRequest, GhCheckRun, clip, getCheckRuns, repoOverview, GithubMergeInput, deleteFiles, readFileByLines, GithubDeleteInput
- `app/lib/gitlab.ts` → glFetch, LIMITS, gitlabWriteEnabled, mergePullRequest, getCheckRuns, pipelineState, deleteFiles, applyPatch, createPullRequest, commit, resolveTargetBranch, fileBlobId, listIssues, readByLines, readFile, listFiles, repoOverview, verifyRepo, defaultBranch, describeError, glMessage
- `app/lib/llm-embed.ts` → hashEmbedText, MODEL, viaRest, viaBinding, localEmbed, embeddingCacheSet, embed, embeddingCacheGet
- `app/lib/local-agent.ts` → headers, saveLocalToken, agentToken, LocalAgentResult, openAppLocally, checkLocalAgent
- `app/lib/memory-extract.ts` → heuristicExtract, sanitizeExtracted, sanitizeJson, SYSTEM_PROMPT, GROQ_API, extractMemories
- `app/lib/memory.ts` → toStored, getMemoryById, findMemoryById, createMemory, MemoryUpdate, updateMemory, searchSemanticMemories, MemoryFilters, searchMemories, reinforceMemories, ConsolidateOptions, consolidateMemories, getMemoryStats, recordEpisode, updateWorkingMemory, getContext, setContext, maybeConsolidate, MEMORY_TYPES, StoredMemory
- `app/lib/notes.ts` → tagsJson, parseTags, listNotes, deleteNote, updateNote, saveNote, findNote, NoteRecord, toRecord, getNote
- `app/lib/num.ts` → clamp01, round01, round3
- `app/lib/persist-messages.ts` → MessageInput, hydrateMessages, persistMessages
- `app/lib/prisma.ts` → globalForPrisma, currentRequestContext, RequestContext, createClient, AdapterFactory, prisma, getPrisma
- `app/lib/providers.ts` → OPENROUTER, WORKERS_AI, Provider, ProviderId, isModelAvailable, catalogWithAvailability, groqChatModels, RESERVE_MODEL, MODEL_CATALOG, GEMINI
- `app/lib/quota-info.ts` → formatHourMinute, formatNeuronsRemaining, groqStatusLabel, quotaTooltip
- `app/lib/quota.ts` → fallbackBudgetLeft, getFallbackBudget, FallbackBudget, latestGroqQuotaUntil, GROQ_QUOTA_KEY, FALLBACK_NEURON_BUDGET, nextMidnightUtc, untilFromError, parseResetWindow, pruneQuotaMap, estimateNeurons, readQuota, writeQuota, getQuotaMap, modelQuotaUntil, markGroqQuota, firstAvailableGroqModel, chargeFallback, estimateEmbeddingNeurons, chargeEmbedding
- `app/lib/rate-limit.ts` → RateLimitBinding, rateLimit
- `app/lib/scrub.ts` → RULES, ScrubResult, ScrubKind, scrubText
- `app/lib/sources.ts` → sourceTitle, toSourceRefs
- `app/lib/sse.ts` → readSseLines, openAiDelta
- `app/lib/store.ts` → createConversation, deleteConversation, getConversations, updateConversation
- `app/lib/tokens.ts` → estimateMessagesTokens, DEFAULT_CONTEXT_BUDGET, CHARS_PER_TOKEN, estimateTokens
- `app/lib/tools.ts` → updateCloudNoteTool, readNote, revertChangeTool, getWeather, githubGetCheckRuns, searchCodeTool, MathParser, calculate, getTime, webSearch, searchVault, saveNote, githubApplyPatch, callGroqWithTools, recallMemory, MATH_FUNCTIONS, listCloudNotes, saveCloudNote, MATH_CONSTANTS, GROQ_API, bodyModel, groqFetch, TOOL_DEFINITIONS, readCloudNote, NOTE_READ_MAX, githubMergePullRequest, executeToolCall, githubDeleteFile, openApp, sendEmailTool, githubRepoOverview, githubListFiles, githubReadFile, githubListIssues, githubCreatePullRequest, updateMemoryTool, semanticSearchVault, memorySnapshot
- `app/lib/truncate.ts` → normalizeOffset, TextWindow, sliceWindow, stubToolResult
- `app/lib/vault-docs.ts` → firstHeading, vaultRelPath, PROJECT_DOCS, DocSource, renderDoc
- `app/lib/vault-index.ts` → searchVaultIndex, semanticSearch, getVaultIndex, buildIndex, isIndexFresh, INDEX_FILE
- `app/lib/web-search.ts` → searchStackOverflow, subjectOf, wikiSearch, DISAMBIGUATION, entityCandidates, STOPWORDS, decodeEntities, WebSearchOutcome, USER_AGENT, filterRelevant, cache, stackOverflowThrottled, SOURCES, RELEASE_INTENT, recentSearches, OFFICIAL_VERSION_SOURCES, HnAlgolia, releaseNotes, RELEASE_NOISE, splitQualifier, searchHackerNews, searchWikipedia, officialVersion, StackExchange, WEB_SIGNALS, searchFirecrawl, FirecrawlResponse, searchMdn, looksSpanish, NEWS_INTENT, FIRECRAWL_ENDPOINT, getCachedJson, searchReleases, topSections, RELEASE_SOURCES, searchVersions, EolCatalog, EolDetail, VERSION_INTENT, CODE_SIGNALS, searchWeb, getJson, MdnSearch
- `app/lib/whatsapp.ts` → markWhatsAppRead, markdownToWhatsApp, GRAPH_VERSION, allowedNumbers, verifyMetaSignature, parseIncoming, safeEqualHex, sendWhatsAppText, chunkText
- `app/lib/workers-ai.ts` → AiBinding, LT, ThinkFilter, workersAiChatStream, normalizeToOpenAiSse
- `app/lib/zip.ts` → safeFileName, encoder, getCrcTable, crc32, createZip

## app/types/
- `app/types/index.ts` → AIModel, AVAILABLE_MODELS, Message, QuotaInfo, ContextInfo, SourceRef, MemoryRecord

## local-agent/
- `local-agent/aria-local-agent.mjs` → resolveTarget, __dirname, loadEnvFile, TOKEN_FILE, TOKEN, APP_ALIASES, launch, isOriginAllowed, corsHeaders, send, readBody, server

## scripts/
- `scripts/build-lora-dataset.ts` → main, leerDeBaseDeDatos, conversacionesFalsas, aEjemplo, arg, SISTEMA
- `scripts/docs-to-vault.ts` → Copiado, arg, indexar, main
- `scripts/generate-icons.mjs` → jobs, root
- `scripts/index-code.ts` → Env, walk, buildRepoMap, main
- `scripts/measure-tokens.ts` → formatReport, SAMPLE_SUMMARY, TokenReport, SAMPLE_HISTORY, SAMPLE_MEMORY, buildTokenReport, invokedDirectly
- `scripts/patch-opennext-wasm.mjs` → header, matches, copyWasm, root
- `scripts/reindex.ts` → main
- `scripts/retrieval-eval.ts` → CASES, CaseMetrics, rankCaseDocs, NOW, mrr, recallAtK, EvalDoc, RankedHit, invokedDirectly, formatRetrievalReport, buildRetrievalEvalReport
- `scripts/smoke-brain.ts` → SOURCE
- `scripts/smoke-changelog.ts` → main
- `scripts/smoke-code-search.ts` → main
- `scripts/smoke-memory.ts` → main
- `scripts/test-migrate.mjs` → url, opts, lastError, sleep
- `scripts/wasm-resolver.mjs` → resolve, load

## tests/integration/
- `tests/integration/brain.test.ts` → marker, RUN
- `tests/integration/conversations-persist.test.ts` → auth, RUN
- `tests/integration/embedding-cache.test.ts` → vec, RUN
- `tests/integration/memory.test.ts` → RUN, marker
- `tests/integration/quota-api.test.ts` → RUN
- `tests/integration/working-memory.test.ts` → RUN, marker

## tests/unit/
- `tests/unit/aria-core.test.ts` → user
- `tests/unit/auth.test.ts` → req, saved
- `tests/unit/brain.test.ts` → makeHit, hitAt
- `tests/unit/chat-draft.test.ts` → fakeStorage
- `tests/unit/code-index.test.ts` → fn
- `tests/unit/context-info.test.ts` → base
- `tests/unit/data-change.test.ts` → changeRow, memoryMod, changeMod, call, memoryRow, noteRow
- `tests/unit/github-checks.test.ts` → json, Handlers, stubChecks
- `tests/unit/github-limits.test.ts` → stubGithub, b64
- `tests/unit/github-patch.test.ts` → json, b64
- `tests/unit/github-write.test.ts` → json, enableWrite, restoreEnv
- `tests/unit/quota-info.test.ts` → quota
- `tests/unit/select-tools.test.ts` → user, names
- `tests/unit/sources.test.ts` → messageHit, memHit, noteHit, vaultHit
- `tests/unit/sse.test.ts` → collect, streamOf
- `tests/unit/tools-rounds.test.ts` → ReqMessage, finalText, toolCallTurn
- `tests/unit/whatsapp.test.ts` → sign
