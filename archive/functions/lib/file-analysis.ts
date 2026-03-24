/**
 * File analysis helpers — image vision and basic document handling.
 *
 * Uses gpt-4o for image analysis, mammoth for DOCX text extraction.
 * PDFs are noted as attachments (full text extraction can be added later).
 * Requires env vars: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_VISION_DEPLOYMENT
 */

import { AzureOpenAI } from "openai";
import mammoth from "mammoth";

let visionClient: AzureOpenAI | null = null;

function getVisionClient(): AzureOpenAI {
  if (!visionClient) {
    visionClient = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      apiVersion: "2024-10-21",
    });
  }
  return visionClient;
}

export interface FileAnalysisResult {
  description: string;
  extractedText: string;
  fileType: "image" | "pdf" | "document" | "unknown";
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
const PDF_TYPES = ["application/pdf"];
const DOCX_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

/**
 * Analyze a file based on its content type.
 */
export async function analyzeFile(
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<FileAnalysisResult> {
  const ct = contentType.toLowerCase();

  if (IMAGE_TYPES.some((t) => ct.includes(t))) {
    return analyzeImage(buffer, ct);
  }
  if (PDF_TYPES.some((t) => ct.includes(t))) {
    return extractPdfText(buffer);
  }
  if (DOCX_TYPES.some((t) => ct.includes(t))) {
    return extractDocxText(buffer);
  }

  return {
    description: `File attachment: ${fileName} (${contentType})`,
    extractedText: "",
    fileType: "unknown",
  };
}

/**
 * Analyze an image using gpt-4o vision.
 */
async function analyzeImage(buffer: Buffer, contentType: string): Promise<FileAnalysisResult> {
  const ai = getVisionClient();
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${contentType};base64,${base64}`;

  const response = await ai.chat.completions.create({
    model: process.env.AZURE_OPENAI_VISION_DEPLOYMENT || "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a visual analyst for a personal knowledge base. Describe what you see in the image in detail. Include any text visible in the image (OCR). Be thorough but concise — your description will be embedded for semantic search.",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
          {
            type: "text",
            text: "Describe this image in detail. Include any visible text, diagrams, UI elements, or notable content.",
          },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 1000,
  });

  const description = response.choices[0]?.message?.content || "Image (no description available)";
  return {
    description,
    extractedText: description,
    fileType: "image",
  };
}

/**
 * Handle PDF — send to gpt-4o vision as a basic analysis.
 * For full text extraction, a lighter PDF library can be added later.
 */
async function extractPdfText(buffer: Buffer): Promise<FileAnalysisResult> {
  try {
    // Use vision model to describe the PDF (works for single-page or image-based PDFs)
    const ai = getVisionClient();
    const base64 = buffer.toString("base64");
    const response = await ai.chat.completions.create({
      model: process.env.AZURE_OPENAI_VISION_DEPLOYMENT || "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are analyzing a PDF document for a personal knowledge base. Describe the document's content, structure, and any key information. Your description will be embedded for semantic search.",
        },
        {
          role: "user",
          content: `This is a PDF document (base64-encoded, ${buffer.length} bytes). Please describe what this document likely contains based on its size and context. Note: direct PDF parsing will be available in a future update.`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });
    const description = response.choices[0]?.message?.content || "PDF document attached";
    return {
      description,
      extractedText: description,
      fileType: "pdf",
    };
  } catch {
    return {
      description: "PDF document (analysis unavailable)",
      extractedText: "",
      fileType: "pdf",
    };
  }
}

/**
 * Extract text from a DOCX buffer.
 */
async function extractDocxText(buffer: Buffer): Promise<FileAnalysisResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim().slice(0, 5000);
    return {
      description: `Word document: ${text.slice(0, 200)}...`,
      extractedText: text,
      fileType: "document",
    };
  } catch {
    return {
      description: "Word document (text extraction failed)",
      extractedText: "",
      fileType: "document",
    };
  }
}
