'use server';

import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function improveText(text: string, type: 'summary' | 'bullet' | 'project', customInstruction?: string) {
    if (!text) return "";

    let basePrompt: string;
    if (type === 'summary') {
        basePrompt = `Rewrite the following professional summary to be more impactful, concise, and professional. Highlight key achievements if possible.`;
    } else if (type === 'project') {
        basePrompt = `Summarize the following project README or description into a concise resume bullet point. Include the technologies used and key achievements.`;
    } else {
        basePrompt = `Rewrite the following resume bullet point to use strong action verbs, quantify results if possible, and be more professional.`;
    }

    // Add custom instruction if provided
    const instruction = customInstruction ? ` ${customInstruction}` : '';
    const prompt = `${basePrompt}${instruction}\n\nOutput ONLY the rewritten text, nothing else.\n\nText: "${text}"`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert resume writer. Always output only the requested content, never include instructions or meta-commentary." },
                { role: "user", content: prompt }
            ],
            max_tokens: 300,
            temperature: 0.7,
        });

        const content = response.choices[0].message.content?.trim() || text;
        // Remove any instruction text that might have been included
        return content.replace(/^(Summarize|Rewrite|Output|Bullet point|Here's|Here is):\s*/i, '').trim();
    } catch (error) {
        console.error("AI Error:", error);
        throw new Error("Failed to generate AI improvement.");
    }
}

export async function extractKeywords(jobDescription: string) {
    if (!jobDescription) return [];

    const prompt = `Extract the top 10-15 most important technical skills and keywords from the following job description. Output them as a JSON array of strings. Output ONLY the JSON.\n\nJob Description:\n${jobDescription}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are an expert ATS keyword extractor." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
        });

        const content = response.choices[0].message.content;
        if (!content) return [];

        const parsed = JSON.parse(content);
        return parsed.keywords || parsed.skills || [];
    } catch (error) {
        console.error("AI Keyword Error:", error);
        return [];
    }
}
