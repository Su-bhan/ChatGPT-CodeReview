type Review = {
    lgtm: boolean;
    review_comment: string;
    hunk_header?: string;
};
export declare class Chat {
    private readonly apiKey;
    constructor(apiKey: string);
    private get model();
    private generatePrompt;
    codeReview: (patch: string) => Promise<Review[] | Review>;
}
export {};
