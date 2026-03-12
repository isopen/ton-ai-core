export interface OpenRouterConfig {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    appIdentifier?: string;
    appDisplayName?: string;
    maxHistory?: number;
    monitorInterval?: number;
}

export interface OpenResponsesRequest {
    input: OpenResponsesInput;
    instructions?: string | null;
    metadata?: OpenResponsesRequestMetadata | null;
    tools?: Array<
        | OpenResponsesFunctionTool
        | OpenResponsesWebSearchPreviewTool
        | OpenResponsesWebSearchPreview20250311Tool
        | OpenResponsesWebSearchTool
        | OpenResponsesWebSearch20250826Tool
    >;
    tool_choice?: OpenAIResponsesToolChoice;
    parallel_tool_calls?: boolean | null;
    model?: string;
    models?: string[];
    text?: ResponseTextConfig;
    reasoning?: OpenAIResponsesReasoningConfig | null;
    max_output_tokens?: number | null;
    temperature?: number | null;
    top_p?: number | null;
    top_logprobs?: number | null;
    max_tool_calls?: number | null;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
    top_k?: number;
    image_config?: Record<string, string | number>;
    modalities?: ResponsesOutputModality[];
    prompt_cache_key?: string | null;
    previous_response_id?: string | null;
    prompt?: OpenAIResponsesPrompt | null;
    include?: OpenAIResponsesIncludable[] | null;
    background?: boolean | null;
    safety_identifier?: string | null;
    store?: boolean;
    service_tier?: 'auto';
    truncation?: OpenAIResponsesTruncation;
    stream?: boolean;
    provider?: ProviderPreferences | null;
    plugins?: Plugin[];
    route?: 'fallback' | 'sort' | null;
    user?: string;
    session_id?: string;
    trace?: TraceMetadata;
}

export type OpenResponsesInput =
    | string
    | Array<
        | OpenResponsesReasoning
        | OpenResponsesEasyInputMessage
        | OpenResponsesInputMessageItem
        | OpenResponsesFunctionToolCall
        | OpenResponsesFunctionCallOutput
        | ResponsesOutputMessage
        | ResponsesOutputItemReasoning
        | ResponsesOutputItemFunctionCall
        | ResponsesWebSearchCallOutput
        | ResponsesOutputItemFileSearchCall
        | ResponsesImageGenerationCall
    >;

export interface OpenResponsesEasyInputMessage {
    type?: 'message';
    role: 'user' | 'system' | 'assistant' | 'developer';
    content: string | Array<
        | ResponseInputText
        | ResponseInputImage
        | ResponseInputFile
        | ResponseInputAudio
        | ResponseInputVideo
    >;
}

export interface OpenResponsesInputMessageItem {
    id?: string;
    type?: 'message';
    role: 'user' | 'system' | 'developer';
    content: Array<
        | ResponseInputText
        | ResponseInputImage
        | ResponseInputFile
        | ResponseInputAudio
        | ResponseInputVideo
    >;
}

export interface ResponseInputText {
    type: 'input_text';
    text: string;
}

export interface ResponseInputImage {
    type: 'input_image';
    detail?: 'auto' | 'high' | 'low';
    image_url?: string | null;
}

export interface ResponseInputFile {
    type: 'input_file';
    file_id?: string | null;
    file_data?: string;
    filename?: string;
    file_url?: string;
}

export interface ResponseInputAudio {
    type: 'input_audio';
    input_audio: {
        data: string;
        format: 'mp3' | 'wav';
    };
}

export interface ResponseInputVideo {
    type: 'input_video';
    video_url: string;
}

export interface OpenResponsesFunctionToolCall {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
    id?: string;
    status?: ToolCallStatus | null;
}

export interface OpenResponsesFunctionCallOutput {
    type: 'function_call_output';
    id?: string | null;
    call_id: string;
    output: string;
    status?: ToolCallStatus | null;
}

export type ToolCallStatus = 'in_progress' | 'completed' | 'incomplete' | null;

export interface OpenResponsesReasoning {
    type: 'reasoning';
    id: string;
    summary: ReasoningSummaryText[];
    content?: ReasoningTextContent[];
    encrypted_content?: string | null;
    status?: 'completed' | 'incomplete' | 'in_progress';
    signature?: string | null;
    format?: 'unknown' | 'openai-responses-v1' | 'azure-openai-responses-v1' | 'xai-responses-v1' | 'anthropic-claude-v1' | 'google-gemini-v1' | null;
}

export interface ReasoningTextContent {
    type: 'reasoning_text';
    text: string;
}

export interface ReasoningSummaryText {
    type: 'summary_text';
    text: string;
}

export interface ResponsesOutputMessage {
    id: string;
    role: 'assistant';
    type: 'message';
    status?: 'completed' | 'incomplete' | 'in_progress';
    content: Array<ResponseOutputText | OpenAIResponsesRefusalContent>;
}

export interface ResponseOutputText {
    type: 'output_text';
    text: string;
    annotations?: OpenAIResponsesAnnotation[];
    logprobs?: Array<{
        token: string;
        bytes: number[];
        logprob: number;
        top_logprobs: Array<{
            token: string;
            bytes: number[];
            logprob: number;
        }>;
    }>;
}

export interface OpenAIResponsesRefusalContent {
    type: 'refusal';
    refusal: string;
}

export type OpenAIResponsesAnnotation = FileCitation | URLCitation | FilePath;

export interface FileCitation {
    type: 'file_citation';
    file_id: string;
    filename: string;
    index: number;
}

export interface URLCitation {
    type: 'url_citation';
    url: string;
    title: string;
    start_index: number;
    end_index: number;
}

export interface FilePath {
    type: 'file_path';
    file_id: string;
    index: number;
}

export interface ResponsesOutputItemReasoning {
    id: string;
    type: 'reasoning';
    status?: 'completed' | 'incomplete' | 'in_progress';
    summary: ReasoningSummaryText[];
    content?: ReasoningTextContent[];
    signature?: string | null;
    format?: string | null;
}

export interface ResponsesOutputItemFunctionCall {
    type: 'function_call';
    id?: string;
    name: string;
    arguments: string;
    call_id: string;
    status?: 'completed' | 'incomplete' | 'in_progress';
}

export interface ResponsesWebSearchCallOutput {
    type: 'web_search_call';
    id: string;
    status: WebSearchStatus;
}

export type WebSearchStatus = 'completed' | 'searching' | 'in_progress' | 'failed';

export interface ResponsesOutputItemFileSearchCall {
    type: 'file_search_call';
    id: string;
    queries: string[];
    status: WebSearchStatus;
}

export interface ResponsesImageGenerationCall {
    type: 'image_generation_call';
    id: string;
    result?: string | null;
    status: ImageGenerationStatus;
}

export type ImageGenerationStatus = 'in_progress' | 'completed' | 'generating' | 'failed';

export interface OpenResponsesFunctionTool {
    type: 'function';
    name: string;
    description?: string | null;
    strict?: boolean | null;
    parameters: Record<string, any> | null;
}

export interface OpenResponsesWebSearchPreviewTool {
    type: 'web_search_preview';
    search_context_size?: ResponsesSearchContextSize;
    user_location?: WebSearchPreviewToolUserLocation | null;
}

export interface OpenResponsesWebSearchPreview20250311Tool {
    type: 'web_search_preview_2025_03_11';
    search_context_size?: ResponsesSearchContextSize;
    user_location?: WebSearchPreviewToolUserLocation | null;
}

export interface OpenResponsesWebSearchTool {
    type: 'web_search';
    filters?: {
        allowed_domains?: string[] | null;
    } | null;
    search_context_size?: ResponsesSearchContextSize;
    user_location?: ResponsesWebSearchUserLocation | null;
}

export interface OpenResponsesWebSearch20250826Tool {
    type: 'web_search_2025_08_26';
    filters?: {
        allowed_domains?: string[] | null;
    } | null;
    search_context_size?: ResponsesSearchContextSize;
    user_location?: ResponsesWebSearchUserLocation | null;
}

export type ResponsesSearchContextSize = 'low' | 'medium' | 'high';

export interface WebSearchPreviewToolUserLocation {
    type: 'approximate';
    city?: string | null;
    country?: string | null;
    region?: string | null;
    timezone?: string | null;
}

export interface ResponsesWebSearchUserLocation {
    type: 'approximate';
    city?: string | null;
    country?: string | null;
    region?: string | null;
    timezone?: string | null;
}

export type OpenAIResponsesToolChoice =
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; name: string }
    | { type: 'web_search_preview_2025_03_11' | 'web_search_preview' };

export interface OpenAIResponsesPrompt {
    id: string;
    variables?: Record<string, string | ResponseInputText | ResponseInputImage | ResponseInputFile> | null;
}

export interface ResponseTextConfig {
    format?: ResponseFormatTextConfig;
    verbosity?: 'high' | 'low' | 'medium' | null;
}

export type ResponseFormatTextConfig =
    | ResponsesFormatText
    | ResponsesFormatJSONObject
    | ResponsesFormatTextJSONSchemaConfig;

export interface ResponsesFormatText {
    type: 'text';
}

export interface ResponsesFormatJSONObject {
    type: 'json_object';
}

export interface ResponsesFormatTextJSONSchemaConfig {
    type: 'json_schema';
    name: string;
    description?: string;
    strict?: boolean | null;
    schema: Record<string, any>;
}

export interface OpenAIResponsesReasoningConfig {
    effort?: OpenAIResponsesReasoningEffort | null;
    summary?: ReasoningSummaryVerbosity;
    max_tokens?: number | null;
    enabled?: boolean | null;
}

export type OpenAIResponsesReasoningEffort = 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none' | null;
export type ReasoningSummaryVerbosity = 'auto' | 'concise' | 'detailed';
export type ResponsesOutputModality = 'text' | 'image';
export type OpenAIResponsesIncludable = 'file_search_call.results' | 'message.input_image.image_url' | 'computer_call_output.output.image_url' | 'reasoning.encrypted_content' | 'code_interpreter_call.outputs';
export type OpenAIResponsesTruncation = 'auto' | 'disabled' | null;

export interface OpenResponsesRequestMetadata {
    [key: string]: string;
}

export interface ProviderPreferences {
    allow_fallbacks?: boolean | null;
    require_parameters?: boolean | null;
    data_collection?: DataCollection;
    zdr?: boolean | null;
    enforce_distillable_text?: boolean | null;
    order?: Array<ProviderName | string> | null;
    only?: Array<ProviderName | string> | null;
    ignore?: Array<ProviderName | string> | null;
    quantizations?: Quantization[] | null;
    sort?: ProviderSort | ProviderSortConfig | null;
    max_price?: {
        prompt?: BigNumberUnion;
        completion?: BigNumberUnion;
        image?: BigNumberUnion;
        audio?: BigNumberUnion;
        request?: BigNumberUnion;
    };
    preferred_min_throughput?: PreferredMinThroughput;
    preferred_max_latency?: PreferredMaxLatency;
}

export type DataCollection = 'deny' | 'allow' | null;
export type ProviderName = string;
export type Quantization = 'int4' | 'int8' | 'fp4' | 'fp6' | 'fp8' | 'fp16' | 'bf16' | 'fp32' | 'unknown';
export type ProviderSort = 'price' | 'throughput' | 'latency';

export interface ProviderSortConfig {
    by?: ProviderSort | null;
    partition?: 'model' | 'none' | null;
}

export type BigNumberUnion = number | string;

export type PreferredMinThroughput = number | PercentileThroughputCutoffs | null;
export type PreferredMaxLatency = number | PercentileLatencyCutoffs | null;

export interface PercentileThroughputCutoffs {
    p50?: number | null;
    p75?: number | null;
    p90?: number | null;
    p99?: number | null;
}

export interface PercentileLatencyCutoffs {
    p50?: number | null;
    p75?: number | null;
    p90?: number | null;
    p99?: number | null;
}

export type Plugin =
    | AutoRouterPlugin
    | ModerationPlugin
    | WebPlugin
    | FileParserPlugin
    | ResponseHealingPlugin;

export interface AutoRouterPlugin {
    id: 'auto-router';
    enabled?: boolean;
    allowed_models?: string[];
}

export interface ModerationPlugin {
    id: 'moderation';
}

export interface WebPlugin {
    id: 'web';
    enabled?: boolean;
    max_results?: number;
    search_prompt?: string;
    engine?: WebSearchEngine;
}

export type WebSearchEngine = 'native' | 'exa';

export interface FileParserPlugin {
    id: 'file-parser';
    enabled?: boolean;
    pdf?: PDFParserOptions;
}

export interface PDFParserOptions {
    engine: PDFParserEngine;
}

export type PDFParserEngine = 'mistral-ocr' | 'pdf-text' | 'native';

export interface ResponseHealingPlugin {
    id: 'response-healing';
    enabled?: boolean;
}

export interface TraceMetadata {
    trace_id?: string;
    trace_name?: string;
    span_name?: string;
    generation_name?: string;
    parent_span_id?: string;
    [key: string]: any;
}

export interface OpenResponsesNonStreamingResponse {
    id: string;
    object: 'response';
    created_at: number;
    model: string;
    status: OpenAIResponsesResponseStatus;
    completed_at: number | null;
    output: ResponsesOutputItem[];
    user?: string | null;
    output_text?: string;
    prompt_cache_key?: string | null;
    safety_identifier?: string | null;
    error?: ResponsesErrorField | null;
    incomplete_details?: OpenAIResponsesIncompleteDetails | null;
    usage?: OpenResponsesUsage;
    max_tool_calls?: number | null;
    top_logprobs?: number;
    max_output_tokens?: number | null;
    temperature?: number | null;
    top_p?: number | null;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
    instructions?: OpenResponsesInput;
    metadata?: OpenResponsesRequestMetadata | null;
    tools?: Array<any>;
    tool_choice?: OpenAIResponsesToolChoice;
    parallel_tool_calls?: boolean;
    prompt?: OpenAIResponsesPrompt | null;
    background?: boolean | null;
    previous_response_id?: string | null;
    reasoning?: OpenAIResponsesReasoningConfig | null;
    service_tier?: OpenAIResponsesServiceTier | null;
    store?: boolean;
    truncation?: OpenAIResponsesTruncation;
    text?: ResponseTextConfig;
}

export type OpenAIResponsesResponseStatus = 'completed' | 'incomplete' | 'in_progress' | 'failed' | 'cancelled' | 'queued';

export type ResponsesOutputItem =
    | ResponsesOutputMessage
    | ResponsesOutputItemReasoning
    | ResponsesOutputItemFunctionCall
    | ResponsesWebSearchCallOutput
    | ResponsesOutputItemFileSearchCall
    | ResponsesImageGenerationCall;

export interface ResponsesErrorField {
    code: string;
    message: string;
}

export interface OpenAIResponsesIncompleteDetails {
    reason?: 'max_output_tokens' | 'content_filter';
}

export interface OpenResponsesUsage {
    input_tokens: number;
    input_tokens_details: {
        cached_tokens: number;
    };
    output_tokens: number;
    output_tokens_details: {
        reasoning_tokens: number;
    };
    total_tokens: number;
    cost?: number | null;
    is_byok?: boolean;
    cost_details?: {
        upstream_inference_cost?: number | null;
        upstream_inference_input_cost: number;
        upstream_inference_output_cost: number;
    };
}

export type OpenAIResponsesServiceTier = 'auto' | 'default' | 'flex' | 'priority' | 'scale' | null;

export type OpenResponsesStreamEvent =
    | OpenResponsesCreatedEvent
    | OpenResponsesInProgressEvent
    | OpenResponsesCompletedEvent
    | OpenResponsesIncompleteEvent
    | OpenResponsesFailedEvent
    | OpenResponsesErrorEvent
    | OpenResponsesOutputItemAddedEvent
    | OpenResponsesOutputItemDoneEvent
    | OpenResponsesContentPartAddedEvent
    | OpenResponsesContentPartDoneEvent
    | OpenResponsesTextDeltaEvent
    | OpenResponsesTextDoneEvent
    | OpenResponsesRefusalDeltaEvent
    | OpenResponsesRefusalDoneEvent
    | OpenResponsesOutputTextAnnotationAddedEvent
    | OpenResponsesFunctionCallArgumentsDeltaEvent
    | OpenResponsesFunctionCallArgumentsDoneEvent
    | OpenResponsesReasoningDeltaEvent
    | OpenResponsesReasoningDoneEvent
    | OpenResponsesReasoningSummaryPartAddedEvent
    | OpenResponsesReasoningSummaryPartDoneEvent
    | OpenResponsesReasoningSummaryTextDeltaEvent
    | OpenResponsesReasoningSummaryTextDoneEvent
    | OpenResponsesImageGenCallInProgress
    | OpenResponsesImageGenCallGenerating
    | OpenResponsesImageGenCallPartialImage
    | OpenResponsesImageGenCallCompleted;

export interface OpenResponsesCreatedEvent {
    type: 'response.created';
    response: OpenAIResponsesNonStreamingResponse;
    sequence_number: number;
}

export interface OpenResponsesInProgressEvent {
    type: 'response.in_progress';
    response: OpenAIResponsesNonStreamingResponse;
    sequence_number: number;
}

export interface OpenResponsesCompletedEvent {
    type: 'response.completed';
    response: OpenAIResponsesNonStreamingResponse;
    sequence_number: number;
}

export interface OpenResponsesIncompleteEvent {
    type: 'response.incomplete';
    response: OpenAIResponsesNonStreamingResponse;
    sequence_number: number;
}

export interface OpenResponsesFailedEvent {
    type: 'response.failed';
    response: OpenAIResponsesNonStreamingResponse;
    sequence_number: number;
}

export interface OpenResponsesErrorEvent {
    type: 'error';
    code: string | null;
    message: string;
    param: string | null;
    sequence_number: number;
}

export interface OpenResponsesOutputItemAddedEvent {
    type: 'response.output_item.added';
    output_index: number;
    item: ResponsesOutputItem;
    sequence_number: number;
}

export interface OpenResponsesOutputItemDoneEvent {
    type: 'response.output_item.done';
    output_index: number;
    item: ResponsesOutputItem;
    sequence_number: number;
}

export interface OpenResponsesContentPartAddedEvent {
    type: 'response.content_part.added';
    output_index: number;
    item_id: string;
    content_index: number;
    part: ResponseOutputText | OpenAIResponsesRefusalContent;
    sequence_number: number;
}

export interface OpenResponsesContentPartDoneEvent {
    type: 'response.content_part.done';
    output_index: number;
    item_id: string;
    content_index: number;
    part: ResponseOutputText | OpenAIResponsesRefusalContent;
    sequence_number: number;
}

export interface OpenResponsesTextDeltaEvent {
    type: 'response.output_text.delta';
    logprobs: OpenResponsesLogProbs[];
    output_index: number;
    item_id: string;
    content_index: number;
    delta: string;
    sequence_number: number;
}

export interface OpenResponsesTextDoneEvent {
    type: 'response.output_text.done';
    output_index: number;
    item_id: string;
    content_index: number;
    text: string;
    sequence_number: number;
    logprobs: OpenResponsesLogProbs[];
}

export interface OpenResponsesRefusalDeltaEvent {
    type: 'response.refusal.delta';
    output_index: number;
    item_id: string;
    content_index: number;
    delta: string;
    sequence_number: number;
}

export interface OpenResponsesRefusalDoneEvent {
    type: 'response.refusal.done';
    output_index: number;
    item_id: string;
    content_index: number;
    refusal: string;
    sequence_number: number;
}

export interface OpenResponsesOutputTextAnnotationAddedEvent {
    type: 'response.output_text.annotation.added';
    output_index: number;
    item_id: string;
    content_index: number;
    sequence_number: number;
    annotation_index: number;
    annotation: OpenAIResponsesAnnotation;
}

export interface OpenResponsesFunctionCallArgumentsDeltaEvent {
    type: 'response.function_call_arguments.delta';
    item_id: string;
    output_index: number;
    delta: string;
    sequence_number: number;
}

export interface OpenResponsesFunctionCallArgumentsDoneEvent {
    type: 'response.function_call_arguments.done';
    item_id: string;
    output_index: number;
    name: string;
    arguments: string;
    sequence_number: number;
}

export interface OpenResponsesReasoningDeltaEvent {
    type: 'response.reasoning_text.delta';
    output_index: number;
    item_id: string;
    content_index: number;
    delta: string;
    sequence_number: number;
}

export interface OpenResponsesReasoningDoneEvent {
    type: 'response.reasoning_text.done';
    output_index: number;
    item_id: string;
    content_index: number;
    text: string;
    sequence_number: number;
}

export interface OpenResponsesReasoningSummaryPartAddedEvent {
    type: 'response.reasoning_summary_part.added';
    output_index: number;
    item_id: string;
    summary_index: number;
    part: ReasoningSummaryText;
    sequence_number: number;
}

export interface OpenResponsesReasoningSummaryPartDoneEvent {
    type: 'response.reasoning_summary_part.done';
    output_index: number;
    item_id: string;
    summary_index: number;
    part: ReasoningSummaryText;
    sequence_number: number;
}

export interface OpenResponsesReasoningSummaryTextDeltaEvent {
    type: 'response.reasoning_summary_text.delta';
    item_id: string;
    output_index: number;
    summary_index: number;
    delta: string;
    sequence_number: number;
}

export interface OpenResponsesReasoningSummaryTextDoneEvent {
    type: 'response.reasoning_summary_text.done';
    item_id: string;
    output_index: number;
    summary_index: number;
    text: string;
    sequence_number: number;
}

export interface OpenResponsesImageGenCallInProgress {
    type: 'response.image_generation_call.in_progress';
    item_id: string;
    output_index: number;
    sequence_number: number;
}

export interface OpenResponsesImageGenCallGenerating {
    type: 'response.image_generation_call.generating';
    item_id: string;
    output_index: number;
    sequence_number: number;
}

export interface OpenResponsesImageGenCallPartialImage {
    type: 'response.image_generation_call.partial_image';
    item_id: string;
    output_index: number;
    sequence_number: number;
    partial_image_b64: string;
    partial_image_index: number;
}

export interface OpenResponsesImageGenCallCompleted {
    type: 'response.image_generation_call.completed';
    item_id: string;
    output_index: number;
    sequence_number: number;
}

export interface OpenAIResponsesNonStreamingResponse {
    id: string;
    object: 'response';
    created_at: number;
    model: string;
    status: OpenAIResponsesResponseStatus;
    completed_at: number | null;
    output: Array<any>;
    user?: string | null;
    output_text?: string;
    prompt_cache_key?: string | null;
    safety_identifier?: string | null;
    error?: ResponsesErrorField | null;
    incomplete_details?: OpenAIResponsesIncompleteDetails | null;
    usage?: OpenAIResponsesUsage;
    max_tool_calls?: number | null;
    top_logprobs?: number;
    max_output_tokens?: number | null;
    temperature?: number | null;
    top_p?: number | null;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
    instructions?: OpenAIResponsesInput;
    metadata?: OpenResponsesRequestMetadata | null;
    tools?: Array<any>;
    tool_choice?: OpenAIResponsesToolChoice;
    parallel_tool_calls?: boolean;
    prompt?: OpenAIResponsesPrompt | null;
    background?: boolean | null;
    previous_response_id?: string | null;
    reasoning?: OpenAIResponsesReasoningConfig | null;
    service_tier?: OpenAIResponsesServiceTier | null;
    store?: boolean;
    truncation?: OpenAIResponsesTruncation;
    text?: ResponseTextConfig;
}

export interface OpenAIResponsesUsage {
    input_tokens: number;
    input_tokens_details: {
        cached_tokens: number;
    };
    output_tokens: number;
    output_tokens_details: {
        reasoning_tokens: number;
    };
    total_tokens: number;
}

export type OpenAIResponsesInput = string | Array<any> | null;

export interface OpenResponsesLogProbs {
    logprob: number;
    token: string;
    top_logprobs?: OpenResponsesTopLogprobs[];
}

export interface OpenResponsesTopLogprobs {
    token: string;
    logprob: number;
}

export interface BadRequestResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface UnauthorizedResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface PaymentRequiredResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface NotFoundResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface RequestTimeoutResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface PayloadTooLargeResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface UnprocessableEntityResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface TooManyRequestsResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface InternalServerResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface BadGatewayResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface ServiceUnavailableResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface EdgeNetworkTimeoutResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface ProviderOverloadedResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface ForbiddenResponse {
    error: {
        code: number;
        message: string;
        metadata?: Record<string, any> | null;
    };
    user_id?: string | null;
}

export interface AnthropicMessagesRequest {
    model: string;
    max_tokens: number;
    messages: OpenRouterAnthropicMessageParam[];
    system?: string | Array<{
        type: 'text';
        text: string;
        citations?: any[] | null;
        cache_control?: {
            type: 'ephemeral';
            ttl?: '5m' | '1h';
        };
    }>;
    metadata?: {
        user_id?: string | null;
    };
    stop_sequences?: string[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    tools?: Array<
        | {
            name: string;
            description?: string;
            input_schema: {
                type: 'object';
                properties?: any | null;
                required?: string[] | null;
            };
            type?: 'custom';
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'bash_20250124';
            name: 'bash';
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'text_editor_20250124';
            name: 'str_replace_editor';
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'web_search_20250305';
            name: 'web_search';
            allowed_domains?: string[] | null;
            blocked_domains?: string[] | null;
            max_uses?: number | null;
            user_location?: {
                type: 'approximate';
                city?: string | null;
                country?: string | null;
                region?: string | null;
                timezone?: string | null;
            } | null;
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
    >;
    tool_choice?:
    | { type: 'auto'; disable_parallel_tool_use?: boolean }
    | { type: 'any'; disable_parallel_tool_use?: boolean }
    | { type: 'none' }
    | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean };
    thinking?:
    | { type: 'enabled'; budget_tokens: number }
    | { type: 'disabled' }
    | { type: 'adaptive' };
    service_tier?: 'auto' | 'standard_only';
    provider?: ProviderPreferences | null;
    plugins?: Plugin[];
    route?: 'fallback' | 'sort' | null;
    user?: string;
    session_id?: string;
    trace?: TraceMetadata;
    models?: string[];
    output_config?: {
        effort?: 'low' | 'medium' | 'high' | 'max' | null;
    };
}

export interface OpenRouterAnthropicMessageParam {
    role: 'user' | 'assistant';
    content: string | Array<
        | {
            type: 'text';
            text: string;
            citations?: any[] | null;
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'image';
            source: {
                type: 'base64';
                media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
                data: string;
            } | {
                type: 'url';
                url: string;
            };
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'document';
            source: {
                type: 'base64';
                media_type: 'application/pdf';
                data: string;
            } | {
                type: 'text';
                media_type: 'text/plain';
                data: string;
            } | {
                type: 'content';
                content: string | Array<any>;
            } | {
                type: 'url';
                url: string;
            };
            citations?: {
                enabled?: boolean;
            } | null;
            context?: string | null;
            title?: string | null;
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'tool_use';
            id: string;
            name: string;
            input: any | null;
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'tool_result';
            tool_use_id: string;
            content?: string | Array<any>;
            is_error?: boolean;
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'thinking';
            thinking: string;
            signature: string;
        }
        | {
            type: 'redacted_thinking';
            data: string;
        }
        | {
            type: 'server_tool_use';
            id: string;
            name: 'web_search';
            input: any | null;
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'web_search_tool_result';
            tool_use_id: string;
            content: Array<{
                type: 'web_search_result';
                encrypted_content: string;
                title: string;
                url: string;
                page_age?: string | null;
            }> | {
                type: 'web_search_tool_result_error';
                error_code: 'invalid_tool_input' | 'unavailable' | 'max_uses_exceeded' | 'too_many_requests' | 'query_too_long';
            };
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
        | {
            type: 'search_result';
            source: string;
            title: string;
            content: Array<{
                type: 'text';
                text: string;
                citations?: any[] | null;
                cache_control?: {
                    type: 'ephemeral';
                    ttl?: '5m' | '1h';
                };
            }>;
            citations?: {
                enabled?: boolean;
            };
            cache_control?: {
                type: 'ephemeral';
                ttl?: '5m' | '1h';
            };
        }
    >;
}

export interface AnthropicMessagesResponse {
    id: string;
    type: 'message';
    role: 'assistant';
    content: Array<{
        type: 'text';
        text: string;
        citations: any[] | null;
    } | {
        type: 'tool_use';
        id: string;
        name: string;
        input: any | null;
    } | {
        type: 'thinking';
        thinking: string;
        signature: string;
    } | {
        type: 'redacted_thinking';
        data: string;
    } | {
        type: 'server_tool_use';
        id: string;
        name: 'web_search';
        input: any | null;
    } | {
        type: 'web_search_tool_result';
        tool_use_id: string;
        content: any;
    }>;
    model: string;
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal' | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number | null;
        cache_read_input_tokens: number | null;
        cache_creation?: {
            ephemeral_5m_input_tokens: number;
            ephemeral_1h_input_tokens: number;
        } | null;
        inference_geo?: string | null;
        server_tool_use?: {
            web_search_requests: number;
        } | null;
        service_tier?: 'standard' | 'priority' | 'batch' | null;
    };
}

export type AnthropicMessagesStreamEvent =
    | { type: 'message_start'; message: AnthropicMessagesResponse }
    | {
        type: 'message_delta';
        delta: {
            stop_reason: string | null;
            stop_sequence: string | null;
        };
        usage: {
            input_tokens: number | null;
            output_tokens: number;
            cache_creation_input_tokens: number | null;
            cache_read_input_tokens: number | null;
            server_tool_use?: {
                web_search_requests: number;
            } | null;
        };
    }
    | { type: 'message_stop' }
    | {
        type: 'content_block_start';
        index: number;
        content_block: any;
    }
    | {
        type: 'content_block_delta';
        index: number;
        delta: any;
    }
    | { type: 'content_block_stop'; index: number }
    | { type: 'ping' }
    | { type: 'error'; error: { type: string; message: string } };

export interface Model {
    id: string;
    canonical_slug: string;
    hugging_face_id?: string | null;
    name: string;
    created: number;
    description?: string;
    pricing: PublicPricing;
    context_length: number | null;
    architecture: ModelArchitecture;
    top_provider: TopProviderInfo;
    per_request_limits?: PerRequestLimits | null;
    supported_parameters: Parameter[];
    default_parameters?: DefaultParameters | null;
    expiration_date?: string | null;
}

export interface PublicPricing {
    prompt: BigNumberUnion;
    completion: BigNumberUnion;
    request?: BigNumberUnion;
    image?: BigNumberUnion;
    image_token?: BigNumberUnion;
    image_output?: BigNumberUnion;
    audio?: BigNumberUnion;
    audio_output?: BigNumberUnion;
    input_audio_cache?: BigNumberUnion;
    web_search?: BigNumberUnion;
    internal_reasoning?: BigNumberUnion;
    input_cache_read?: BigNumberUnion;
    input_cache_write?: BigNumberUnion;
    discount?: number;
}

export interface ModelArchitecture {
    tokenizer?: ModelGroup | null;
    instruct_type?: InstructType | null;
    modality: string | null;
    input_modalities: InputModality[];
    output_modalities: OutputModality[];
}

export type ModelGroup = 'Router' | 'Media' | 'Other' | 'GPT' | 'Claude' | 'Gemini' | 'Grok' | 'Cohere' | 'Nova' | 'Qwen' | 'Yi' | 'DeepSeek' | 'Mistral' | 'Llama2' | 'Llama3' | 'Llama4' | 'PaLM' | 'RWKV' | 'Qwen3';
export type InstructType = 'none' | 'airoboros' | 'alpaca' | 'alpaca-modif' | 'chatml' | 'claude' | 'code-llama' | 'gemma' | 'llama2' | 'llama3' | 'mistral' | 'nemotron' | 'neural' | 'openchat' | 'phi3' | 'rwkv' | 'vicuna' | 'zephyr' | 'deepseek-r1' | 'deepseek-v3.1' | 'qwq' | 'qwen3' | null;
export type InputModality = 'text' | 'image' | 'file' | 'audio' | 'video';
export type OutputModality = 'text' | 'image' | 'embeddings' | 'audio';

export interface TopProviderInfo {
    context_length: number | null;
    max_completion_tokens?: number | null;
    is_moderated: boolean;
}

export interface PerRequestLimits {
    prompt_tokens: number;
    completion_tokens: number;
}

export type Parameter = 'temperature' | 'top_p' | 'top_k' | 'min_p' | 'top_a' | 'frequency_penalty' | 'presence_penalty' | 'repetition_penalty' | 'max_tokens' | 'logit_bias' | 'logprobs' | 'top_logprobs' | 'seed' | 'response_format' | 'structured_outputs' | 'stop' | 'tools' | 'tool_choice' | 'parallel_tool_calls' | 'include_reasoning' | 'reasoning' | 'reasoning_effort' | 'web_search_options' | 'verbosity';

export interface DefaultParameters {
    temperature?: number | null;
    top_p?: number | null;
    frequency_penalty?: number | null;
}

export interface ModelsListResponse {
    data: Model[];
}

export interface ModelsCountResponse {
    data: {
        count: number;
    };
}

export interface PublicEndpoint {
    name: string;
    model_id: string;
    model_name: string;
    context_length: number;
    pricing: {
        prompt: BigNumberUnion;
        completion: BigNumberUnion;
        request?: BigNumberUnion;
        image?: BigNumberUnion;
        image_token?: BigNumberUnion;
        image_output?: BigNumberUnion;
        audio?: BigNumberUnion;
        audio_output?: BigNumberUnion;
        input_audio_cache?: BigNumberUnion;
        web_search?: BigNumberUnion;
        internal_reasoning?: BigNumberUnion;
        input_cache_read?: BigNumberUnion;
        input_cache_write?: BigNumberUnion;
        discount?: number;
    };
    provider_name: ProviderName;
    tag: string;
    quantization: Quantization | null;
    max_completion_tokens: number | null;
    max_prompt_tokens: number | null;
    supported_parameters: Parameter[];
    status: EndpointStatus;
    uptime_last_30m: number | null;
    supports_implicit_caching: boolean;
    latency_last_30m: PercentileStats | null;
    throughput_last_30m: PercentileStats | null;
}

export type EndpointStatus = 0 | -1 | -2 | -3 | -5 | -10;

export interface PercentileStats {
    p50: number;
    p75: number;
    p90: number;
    p99: number;
}

export interface ListEndpointsResponse {
    id: string;
    name: string;
    created: number;
    description?: string;
    architecture: {
        tokenizer?: ModelGroup | null;
        instruct_type?: InstructType | null;
        modality?: string | null;
        input_modalities: InputModality[];
        output_modalities: OutputModality[];
    };
    endpoints: PublicEndpoint[];
}

export interface ActivityItem {
    date: string;
    model: string;
    model_permaslug: string;
    endpoint_id: string;
    provider_name: string;
    usage: number;
    byok_usage_inference: number;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
}

export interface CreateChargeRequest {
    amount: number;
    sender: string;
    chain_id: 1 | 137 | 8453;
}

export interface EmbeddingsRequest {
    input: string | string[] | number[] | number[][] | Array<{ content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }>;
    model: string;
    encoding_format?: 'float' | 'base64';
    dimensions?: number;
    user?: string;
    provider?: ProviderPreferences;
    input_type?: string;
}

export interface GenerationInfo {
    id: string;
    upstream_id: string | null;
    total_cost: number;
    cache_discount: number | null;
    upstream_inference_cost: number | null;
    created_at: string;
    model: string;
    app_id: number | null;
    streamed: boolean | null;
    cancelled: boolean | null;
    provider_name: string | null;
    latency: number | null;
    moderation_latency: number | null;
    generation_time: number | null;
    finish_reason: string | null;
    tokens_prompt: number | null;
    tokens_completion: number | null;
    native_tokens_prompt: number | null;
    native_tokens_completion: number | null;
    native_tokens_completion_images: number | null;
    native_tokens_reasoning: number | null;
    native_tokens_cached: number | null;
    num_media_prompt: number | null;
    num_input_audio_prompt: number | null;
    num_media_completion: number | null;
    num_search_results: number | null;
    origin: string;
    usage: number;
    is_byok: boolean;
    native_finish_reason: string | null;
    external_user: string | null;
    api_type: 'completions' | 'embeddings' | null;
    router: string | null;
    provider_responses?: Array<{
        id?: string;
        endpoint_id?: string;
        model_permaslug?: string;
        provider_name?: ProviderName;
        status: number | null;
        latency?: number;
        is_byok?: boolean;
    }> | null;
}

export interface ApiKey {
    hash: string;
    name: string;
    label: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    include_byok_in_limit: boolean;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    byok_usage: number;
    byok_usage_daily: number;
    byok_usage_weekly: number;
    byok_usage_monthly: number;
    created_at: string;
    updated_at: string | null;
    expires_at?: string | null;
}

export interface ApiKeyInfo {
    label: string;
    limit: number | null;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    byok_usage: number;
    byok_usage_daily: number;
    byok_usage_weekly: number;
    byok_usage_monthly: number;
    is_free_tier: boolean;
    is_management_key: boolean;
    is_provisioning_key: boolean;
    limit_remaining: number | null;
    limit_reset: string | null;
    include_byok_in_limit: boolean;
    expires_at?: string | null;
    rate_limit: {
        requests: number;
        interval: string;
        note: string;
    };
}

export interface CreateApiKeyRequest {
    name: string;
    limit?: number | null;
    limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
    include_byok_in_limit?: boolean;
    expires_at?: string | null;
}

export interface CreateApiKeyResponse {
    data: ApiKey;
    key: string;
}

export interface Guardrail {
    id: string;
    name: string;
    description?: string | null;
    limit_usd?: number | null;
    reset_interval?: 'daily' | 'weekly' | 'monthly' | null;
    allowed_providers?: string[] | null;
    allowed_models?: string[] | null;
    enforce_zdr?: boolean | null;
    created_at: string;
    updated_at?: string | null;
}

export interface ExchangeAuthCodeRequest {
    code: string;
    code_verifier?: string;
    code_challenge_method?: 'S256' | 'plain' | null;
}

export interface ExchangeAuthCodeResponse {
    key: string;
    user_id: string | null;
}

export interface CreateAuthCodeRequest {
    callback_url: string;
    code_challenge?: string;
    code_challenge_method?: 'S256' | 'plain';
    limit?: number;
    expires_at?: string | null;
}

export interface Provider {
    name: string;
    slug: string;
    privacy_policy_url: string | null;
    terms_of_service_url?: string | null;
    status_page_url?: string | null;
}

export interface ChatCompletionRequest {
    messages: Message[];
    model?: string;
    models?: string[];
    frequency_penalty?: number | null;
    logit_bias?: Record<string, number> | null;
    logprobs?: boolean | null;
    top_logprobs?: number | null;
    max_completion_tokens?: number | null;
    max_tokens?: number | null;
    metadata?: Record<string, string>;
    presence_penalty?: number | null;
    reasoning?: {
        effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none' | null;
        summary?: ReasoningSummaryVerbosity | null;
    };
    response_format?: { type: 'text' } | { type: 'json_object' } | ResponseFormatJSONSchema | ResponseFormatTextGrammar | { type: 'python' };
    seed?: number | null;
    stop?: string | string[] | null;
    stream?: boolean;
    stream_options?: ChatStreamOptions | null;
    temperature?: number | null;
    parallel_tool_calls?: boolean | null;
    tool_choice?: ToolChoiceOption;
    tools?: ToolDefinitionJson[];
    top_p?: number | null;
    debug?: {
        echo_upstream_body?: boolean;
    };
    image_config?: Record<string, string | number | any[]>;
    modalities?: ('text' | 'image')[];
    provider?: ProviderPreferences | null;
    plugins?: Plugin[];
    route?: 'fallback' | 'sort' | null;
    user?: string;
    session_id?: string;
    trace?: TraceMetadata;
}

export type Message =
    | SystemMessage
    | UserMessage
    | DeveloperMessage
    | AssistantMessage
    | ToolResponseMessage;

export interface SystemMessage {
    role: 'system';
    content: string | Array<ChatMessageContentItemText>;
    name?: string;
}

export interface UserMessage {
    role: 'user';
    content: string | Array<ChatMessageContentItem>;
    name?: string;
}

export interface DeveloperMessage {
    role: 'developer';
    content: string | Array<ChatMessageContentItemText>;
    name?: string;
}

export interface AssistantMessage {
    role: 'assistant';
    content?: string | Array<ChatMessageContentItem> | null;
    name?: string;
    tool_calls?: ChatMessageToolCall[];
    refusal?: string | null;
    reasoning?: string | null;
    reasoning_details?: any[];
    images?: Array<{ image_url: { url: string } }>;
}

export interface ToolResponseMessage {
    role: 'tool';
    content: string | Array<ChatMessageContentItem>;
    tool_call_id: string;
}

export type ChatMessageContentItem =
    | ChatMessageContentItemText
    | ChatMessageContentItemImage
    | ChatMessageContentItemAudio
    | ChatMessageContentItemVideo;

export interface ChatMessageContentItemText {
    type: 'text';
    text: string;
    cache_control?: ChatMessageContentItemCacheControl;
}

export interface ChatMessageContentItemImage {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

export interface ChatMessageContentItemAudio {
    type: 'input_audio';
    input_audio: {
        data: string;
        format: string;
    };
}

export type ChatMessageContentItemVideo =
    | {
        type: 'input_video';
        video_url: {
            url: string;
        };
    }
    | {
        type: 'video_url';
        video_url: {
            url: string;
        };
    };

export interface ChatMessageContentItemCacheControl {
    type: 'ephemeral';
    ttl?: '5m' | '1h';
}

export interface ChatMessageToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolDefinitionJson {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
        strict?: boolean | null;
    };
    cache_control?: ChatMessageContentItemCacheControl;
}

export interface ResponseFormatJSONSchema {
    type: 'json_schema';
    json_schema: JSONSchemaConfig;
}

export interface JSONSchemaConfig {
    name: string;
    description?: string;
    schema?: Record<string, any>;
    strict?: boolean | null;
}

export interface ResponseFormatTextGrammar {
    type: 'grammar';
    grammar: string;
}

export type ToolChoiceOption = 'none' | 'auto' | 'required' | NamedToolChoice;

export interface NamedToolChoice {
    type: 'function';
    function: {
        name: string;
    };
}

export interface ChatStreamOptions {
    include_usage?: boolean;
}

export interface ChatResponse {
    id: string;
    choices: ChatResponseChoice[];
    created: number;
    model: string;
    object: 'chat.completion';
    system_fingerprint?: string | null;
    usage?: ChatGenerationTokenUsage;
}

export interface ChatResponseChoice {
    index: number;
    message: AssistantMessage;
    finish_reason: ChatCompletionFinishReason | null;
    logprobs?: ChatMessageTokenLogprobs | null;
}

export type ChatCompletionFinishReason = 'tool_calls' | 'stop' | 'length' | 'content_filter' | 'error';

export interface ChatGenerationTokenUsage {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
        reasoning_tokens?: number | null;
        audio_tokens?: number | null;
        accepted_prediction_tokens?: number | null;
        rejected_prediction_tokens?: number | null;
    } | null;
    prompt_tokens_details?: {
        cached_tokens?: number;
        cache_write_tokens?: number;
        audio_tokens?: number;
        video_tokens?: number;
    } | null;
}

export interface ChatMessageTokenLogprobs {
    content?: ChatMessageTokenLogprob[] | null;
    refusal?: ChatMessageTokenLogprob[] | null;
}

export interface ChatMessageTokenLogprob {
    token: string;
    logprob: number;
    bytes: number[] | null;
    top_logprobs: Array<{
        token: string;
        logprob: number;
        bytes: number[] | null;
    }>;
}

export interface ChatStreamingResponseChunk {
    data: {
        id: string;
        choices: ChatStreamingChoice[];
        created: number;
        model: string;
        object: 'chat.completion.chunk';
        system_fingerprint?: string | null;
        error?: {
            message: string;
            code: number;
        };
        usage?: ChatGenerationTokenUsage;
    };
}

export interface ChatStreamingChoice {
    index: number;
    delta: ChatStreamingMessageChunk;
    finish_reason: ChatCompletionFinishReason | null;
    logprobs?: ChatMessageTokenLogprobs | null;
}

export interface ChatStreamingMessageChunk {
    role?: 'assistant';
    content?: string | null;
    reasoning?: string | null;
    refusal?: string | null;
    tool_calls?: ChatStreamingMessageToolCall[];
    reasoning_details?: any[];
}

export interface ChatStreamingMessageToolCall {
    index: number;
    id?: string;
    type?: 'function';
    function?: {
        name?: string;
        arguments?: string;
    };
}

export interface ChatError {
    error: {
        code?: string | number | null;
        message: string;
        param?: string | null;
        type?: string | null;
    };
}

export interface ChatHistory {
    id: string;
    model: string;
    messages: Message[];
    response: AssistantMessage;
    usage?: ChatGenerationTokenUsage;
    timestamp: number;
    cost?: number;
    provider?: string;
}

export interface VisionAnalysisOptions {
    prompt?: string;
    temperature?: number;
    maxTokens?: number;
    model?: string;
}

export interface VisionAnalysisResult {
    analysis: string;
    model: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    processingTime: number;
}

