import * as coda from "@codahq/packs-sdk";
import OpenAI from "openai";
import { zodResponseFormat } from 'openai/helpers/zod';
import type { AutoParseableResponseFormat } from 'openai/lib/parser';
import { z } from 'zod';
import zodToJsonSchema from "zod-to-json-schema";

export const pack = coda.newPack();

const DEFAULT_IMAGE_MODEL = 'gpt-4o';
const DEFAULT_IMAGE_DETAIL = 'auto';

pack.setUserAuthentication({
    type: coda.AuthenticationType.HeaderBearerToken,
    instructionsUrl: 'https://platform.openai.com/account/api-keys',
});

pack.addNetworkDomain('openai.com');

interface ChatCompletionMessageContentImageUrl {
    url: string;
    detail: string;
}

interface ChatCompletionMessageContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: string | ChatCompletionMessageContentImageUrl;
}

interface ChatCompletionMessage {
    role: 'system' | 'user';
    content: string | ChatCompletionMessageContent[];
}

interface ChatCompletionRequest {
    model: string;
    messages: ChatCompletionMessage[];
    response_format?: AutoParseableResponseFormat<any>;
    max_tokens?: number;
    temperature?: number;
    stop?: string[];
}

function isChatCompletionModel(model: string): boolean {
    // Also works with snapshot model like `gpt-3.5-turbo-0301` & `gpt-4-0314`
    return model.includes('gpt-3.5-turbo') || model.includes('gpt-4');
}

function isStructuredOutputModel(model: string): boolean {
    // Also works with snapshot model like `gpt-4o-2024-11-20` & `gpt-4o-mini-2024-07-18`
    return model.includes('gpt-4o');
}

function isImageInputModel(model: string): boolean {
    // Also works with snapshot model like `gpt-4o-2024-11-20` & `gpt-4o-mini-2024-07-18`
    return model.includes('gpt-4o');
}

function toResponseFormat(jsonString: string) {
    const parsedJson = JSON.parse(jsonString);

    return zodResponseFormat(toZodSchema(parsedJson), "output");
}

function toZodSchema(parsedJson: object) {
    const zObjectShape = {};
    for (let [key, item] of Object.entries(parsedJson)) {
        if (item === "string") {
            Object.assign(zObjectShape, { [key]: z.string() });
        } else if (item === "number") {
            Object.assign(zObjectShape, { [key]: z.number() });
        } else if (typeof item === "object") {
            Object.assign(zObjectShape, { [key]: toZodSchema(item) });
        } else if (Array.isArray(item) && item.length > 0) {
            Object.assign(zObjectShape, { [key]: z.array(toZodSchema(item[0])) });
        } else {
            throw new Error(`Unsupported type: ${item}`);
        }
    }

    return z.object(zObjectShape);
}

pack.addFormula({
    name: "Hello",
    description: "A Hello World example.",
    parameters: [
        coda.makeParameter({
            type: coda.ParameterType.String,
            name: "name",
            description: "The name you would like to say hello to.",
        }),
    ],
    resultType: coda.ValueType.String,
    execute: async function ([name], context) {

        return JSON.stringify({
            type: 'json_schema',
            json_schema: {
              name,
              strict: true,
              additionalProperties: false,
              schema: zodToJsonSchema(z.object({ name: z.string() }), { name }),
            },
          });
        // const testing = z.object({
        //     title: z.string(),
        //     authors: z.array(z.string()),
        //     abstract: z.string(),
        //     keywords: z.array(z.string()),
        //   })
        // return JSON.stringify(testing.shape.abstract);

        // return JSON.stringify(z.object({
        //     title: z.string(),
        //     authors: z.array(z.string()),
        //     abstract: z.string(),
        //     keywords: z.array(z.string()),
        //   }));

        // const structuredOutput = `{\"${name}\": \"string\"}`;
        // const parsedJson = JSON.parse(structuredOutput);
        // const zObjectShape = {};
        // for (let [key, item] of Object.entries(parsedJson)) {
        //     if (item === "string") {
        //         Object.assign(zObjectShape, { [key]: z.string() });
        //     } else if (item === "number") {
        //         Object.assign(zObjectShape, { [key]: z.number() });
        //     } else if (typeof item === "object") {
        //         Object.assign(zObjectShape, { [key]: toZodSchema(item) });
        //     } else if (Array.isArray(item) && item.length > 0) {
        //         Object.assign(zObjectShape, { [key]: z.array(toZodSchema(item[0])) });
        //     } else {
        //         throw new Error(`Unsupported type: ${item}`);
        //     }
        // }
        // return JSON.stringify(zObjectShape);

        // const structuredOutput = `{\"${name}\": \"string\"}`;
        // const parsedJson = JSON.parse(structuredOutput);
        // return JSON.stringify(toZodSchema(parsedJson));

        // return JSON.stringify(zodResponseFormat(z.object({
        //    name: z.string(),
        //   }), "output"));

        // const format = zodResponseFormat(z.object({
        //     name: z.string(),
        // }), "output");
        // return "ok";

        // const openai = new OpenAI();
        // const completion = await openai.beta.chat.completions.parse({
        //     model: "gpt-4o-mini",
        //     messages: [
        //       { role: "system", content: "Extract the event day." },
        //       { role: "user", content: "Alice and Bob are going to a science fair on Friday" },
        //     ],
        //     response_format: zodResponseFormat(z.object({ day: z.string(), who: z.string() }), "result"),
        //   });
        //   return completion.choices[0].message.parsed.day;
    },
});

async function getChatCompletion(context: coda.ExecutionContext, request: ChatCompletionRequest): Promise<string> {
    const resp = await context.fetcher.fetch({
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
    });

    if (!request.response_format) {
        return resp.body.choices[0].message.content.trim();
    } else {
        return JSON.stringify(resp.body);
    }
}

const promptParam = coda.makeParameter({
    type: coda.ParameterType.String,
    name: 'prompt',
    description: 'prompt',
});

const imageUrlParam = coda.makeParameter({
    type: coda.ParameterType.String,
    name: 'imageUrl',
    description: 'imageUrl',
});

const imageDetailParam = coda.makeParameter({
    type: coda.ParameterType.String,
    name: 'imageDetail',
    description: 'the level of detail to use when processing and understanding the image (low, high, or auto to let the model decide)',
    optional: true,
    autocomplete: async () => {
        return [
            'low',
            'high',
            'auto',
        ];
    },
});

const modelParameter = coda.makeParameter({
    type: coda.ParameterType.String,
    name: 'model',
    description:
        "the GPT model to process your request. If you don't specify a model, it defaults to gpt-3.5-turbo-instruct, which is the fastest and lowest cost. For higher quality generation, consider gpt-4. For more information, see https://platform.openai.com/docs/models/overview.",
    optional: true,
    autocomplete: async () => {
        return [
            'gpt-3.5-turbo',
            'gpt-3.5-turbo-instruct',
            'gpt-3.5-turbo-16k',
            'gpt-4',
            'gpt-4-32k',
            'gpt-4o',
            'gpt-4o-mini',
        ];
    },
});

const numTokensParam = coda.makeParameter({
    type: coda.ParameterType.Number,
    name: 'numTokens',
    description:
        'the maximum number of tokens for the completion to output. Defaults to 512. Maximum of 2048 for most models and 4000 for davinci',
    optional: true,
});

const structuredOutputParam = coda.makeParameter({
    type: coda.ParameterType.String,
    name: 'structuredOutput',
    description:
        'Optional. Define a custom structure for response output. Setting this parameter will return a JSON string, can be parsed by `ParseJSON` function.',
    optional: true,
});

const temperatureParam = coda.makeParameter({
    type: coda.ParameterType.Number,
    name: 'temperature',
    description:
        'the temperature for how creative GPT-3 is with the completion. Must be between 0.0 and 1.0. Defaults to 1.0.',
    optional: true,
});

const systemPromptParam = coda.makeParameter({
    type: coda.ParameterType.String,
    name: 'systemPrompt',
    description: "Optional. Helps define the behavior of the assistant. e.g. 'You are a helpful assistant.'",
    optional: true,
});

const stopParam = coda.makeParameter({
    type: coda.ParameterType.StringArray,
    name: 'stop',
    description: 'Optional. Up to 4 sequences where the API will stop generating further tokens.',
    optional: true,
});

pack.addFormula({
    name: 'ChatCompletion',
    description:
        'Takes prompt as input, and return a model-generated message as output. Optionally, you can provide a system message to control the behavior of the chatbot.',
    parameters: [promptParam, systemPromptParam, modelParameter, numTokensParam, temperatureParam, stopParam, structuredOutputParam],
    resultType: coda.ValueType.String,
    onError: handleError,
    execute: async function (
        [userPrompt, systemPrompt, model = 'gpt-3.5-turbo', maxTokens = 512, temperature, stop, structuredOutput],
        context,
    ) {
        coda.assertCondition(isChatCompletionModel(model), 'Must use `gpt-3.5-turbo`-related models for this formula.');

        if (userPrompt.length === 0) {
            return '';
        }

        const messages: ChatCompletionMessage[] = [];

        if (systemPrompt && systemPrompt.length > 0) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        messages.push({ role: 'user', content: userPrompt });

        let responseFormat = null;
        if (structuredOutput) {
            coda.assertCondition(isStructuredOutputModel(model), 'Must use `gpt-4o`-related models to use `structuredOutput` in this formula.');
            // responseFormat = toResponseFormat(structuredOutput);
        }

        const request = {
            model,
            messages,
            response_format: responseFormat,
            max_tokens: maxTokens,
            temperature,
            stop,
        };

        const result = await getChatCompletion(context, request);

        return result;
    },
});

pack.addFormula({
    name: 'Vision',
    description:
        'Takes a prompt and an image URL as input, and return a model-generated message as output. Optionally, you can provide a system message to control the behavior of the chatbot.',
    parameters: [imageUrlParam, promptParam, systemPromptParam, modelParameter, imageDetailParam, numTokensParam, temperatureParam, stopParam],
    resultType: coda.ValueType.String,
    onError: handleError,
    execute: async function (
        [imageUrl, userPrompt, systemPrompt, model = DEFAULT_IMAGE_MODEL, imageDetail = DEFAULT_IMAGE_DETAIL, maxTokens = 512, temperature, stop],
        context,
    ) {
        coda.assertCondition(isImageInputModel(model), 'Must use `gpt-4o`-related models for this formula.');

        if (imageUrl.length === 0 || userPrompt.length === 0) {
            return '';
        }

        const messages: ChatCompletionMessage[] = [];

        if (systemPrompt && systemPrompt.length > 0) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        const textContent: ChatCompletionMessageContent = { type: 'text', text: userPrompt };
        const imageUrlContent: ChatCompletionMessageContent = { type: 'image_url', image_url: { url: imageUrl, detail: imageDetail } };

        messages.push({ role: 'user', content: [textContent, imageUrlContent] });

        const request = {
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            stop,
        };

        const result = await getChatCompletion(context, request);

        return result;
    },
});

function handleError(error: Error) {
    if (coda.StatusCodeError.isStatusCodeError(error)) {
        // Cast the error as a StatusCodeError, for better intellisense.
        let statusError = error as coda.StatusCodeError;
        let message = statusError.body?.error?.message;

        // If the API returned a 400 error with message, show it to the user.
        if (statusError.statusCode === 400 && message) {
            if (message) {
                throw new coda.UserVisibleError(message);
            }
        }
    }
    // The request failed for some other reason. Re-throw the error so that it
    // bubbles up.
    throw error;
}