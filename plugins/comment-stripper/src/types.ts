export interface CommentStripperConfig {
    keepSingleBlank?: boolean;
    preserveHeader?: boolean;
    preserveDocblocks?: boolean;
    verbose?: boolean;
}

export interface StripOptions {
    keepSingleBlank?: boolean;
    preserveHeader?: boolean;
    preserveDocblocks?: boolean;
}

export interface StripTextResult {
    text: string;
    comments: number;
}

export interface StripFileResult {
    file: string;
    lang: string;
    comments: number;
    bytes: number;
    changed: boolean;
}

export interface StripBatchResult {
    files: StripFileResult[];
    errors: string[];
    totalComments: number;
}

export interface UnusedTextResult {
    text: string;
    removed: number;
}

export interface UnusedFileResult {
    file: string;
    lang: string;
    removed: number;
    bytes: number;
    changed: boolean;
}

export interface UnusedBatchResult {
    files: UnusedFileResult[];
    errors: string[];
    totalRemoved: number;
}
