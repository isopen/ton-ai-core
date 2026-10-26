import type { BasePluginConfig } from "@ton-ai/core";

export interface WhisperConfig extends BasePluginConfig {
    /** GGML model file for whisper.cpp (required). */
    modelPath: string;
    binaryPath?: string;
    ffmpegPath?: string;
    language?: string;
    threads?: number;
    gpu?: boolean;
    translate?: boolean;
    prompt?: string;
    extraArgs?: string[];
    maxConcurrent?: number;
    timeoutMs?: number;
    maxBytes?: number;
    tmpPrefix?: string;
    serverUrl?: string;
    serverBin?: string;
    autoServe?: boolean;
}

export interface WhisperJobOptions {
    language?: string;
    translate?: boolean;
    prompt?: string;
    extraArgs?: string[];
}

export interface WhisperFileInput {
    buffer: Buffer;
    filename?: string;
    mime?: string;
}

export interface WhisperTranscription {
    text: string;
    language: string;
    audioSec: number;
    processingMs: number;
    model: string;
}

export interface WhisperProbeResult {
    ok: boolean;
    binaryOk: boolean;
    modelOk: boolean;
    modelSizeBytes: number;
    errors?: string[];
}
