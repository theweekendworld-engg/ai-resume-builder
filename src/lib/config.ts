export const config = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY as string,
        model: process.env.OPENAI_MODEL as string,
    },
    app: {
        url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
};
