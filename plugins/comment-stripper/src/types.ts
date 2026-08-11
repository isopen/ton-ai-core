export interface CommentStripperConfig {
    keepSingleBlank?: boolean;
    verbose?: boolean;
}

export interface StripOptions {
    keepSingleBlank?: boolean;
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
