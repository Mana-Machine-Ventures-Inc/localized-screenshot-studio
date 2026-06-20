import crypto from "node:crypto";
import {
  ascRequest,
  uploadBinary,
  type JsonApiResource,
} from "./client.js";

interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: { name: string; value: string }[];
}

/** Find or create the appScreenshotSet for a localization + display type. */
export async function ensureScreenshotSet(
  token: string,
  versionLocalizationId: string,
  displayType: string,
): Promise<string> {
  const res = await ascRequest(
    token,
    "GET",
    `/v1/appStoreVersionLocalizations/${versionLocalizationId}/appScreenshotSets?limit=50`,
  );
  const sets = (Array.isArray(res.data) ? res.data : [res.data]) as JsonApiResource<{
    screenshotDisplayType?: string;
  }>[];
  const found = sets.find(
    (s) => s.attributes?.screenshotDisplayType === displayType,
  );
  if (found) return found.id;

  const created = await ascRequest(token, "POST", `/v1/appScreenshotSets`, {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: "appStoreVersionLocalizations", id: versionLocalizationId },
        },
      },
    },
  });
  return (created.data as JsonApiResource).id;
}

export interface ReservedScreenshot {
  id: string;
  operations: UploadOperation[];
}

/** Step 1: reserve an appScreenshot, receiving the upload operations. */
export async function reserveScreenshot(
  token: string,
  setId: string,
  fileName: string,
  fileSize: number,
): Promise<ReservedScreenshot> {
  const res = await ascRequest(token, "POST", `/v1/appScreenshots`, {
    data: {
      type: "appScreenshots",
      attributes: { fileName, fileSize },
      relationships: {
        appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } },
      },
    },
  });
  const resource = res.data as JsonApiResource<{
    uploadOperations?: UploadOperation[];
  }>;
  return {
    id: resource.id,
    operations: resource.attributes?.uploadOperations ?? [],
  };
}

/** Step 2: PUT each part to its presigned URL. */
export async function uploadScreenshotParts(
  operations: UploadOperation[],
  buffer: Buffer,
): Promise<void> {
  for (const op of operations) {
    const part = buffer.subarray(op.offset, op.offset + op.length);
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders) headers[h.name] = h.value;
    await uploadBinary(op.url, op.method, headers, part);
  }
}

/** Step 3: commit with the md5 checksum so ASC ingests the asset. */
export async function commitScreenshot(
  token: string,
  id: string,
  buffer: Buffer,
): Promise<void> {
  const md5 = crypto.createHash("md5").update(buffer).digest("hex");
  await ascRequest(token, "PATCH", `/v1/appScreenshots/${id}`, {
    data: {
      type: "appScreenshots",
      id,
      attributes: { uploaded: true, sourceFileChecksum: md5 },
    },
  });
}

export type AssetDeliveryState =
  | "AWAITING_UPLOAD"
  | "UPLOAD_COMPLETE"
  | "COMPLETE"
  | "FAILED"
  | string;

/** Poll the screenshot until ASC reports the asset processed (or failed). */
export async function pollScreenshot(
  token: string,
  id: string,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<{ state: AssetDeliveryState; warnings?: unknown }> {
  const attempts = opts.attempts ?? 20;
  const interval = opts.intervalMs ?? 3000;
  for (let i = 0; i < attempts; i++) {
    const res = await ascRequest(token, "GET", `/v1/appScreenshots/${id}`);
    const attrs = (res.data as JsonApiResource<{
      assetDeliveryState?: { state?: string; errors?: unknown; warnings?: unknown };
    }>).attributes;
    const state = attrs?.assetDeliveryState?.state ?? "AWAITING_UPLOAD";
    if (state === "COMPLETE") return { state };
    if (state === "FAILED") {
      throw new Error(
        `Screenshot ${id} failed processing: ${JSON.stringify(attrs?.assetDeliveryState?.errors)}`,
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return { state: "UPLOAD_COMPLETE" };
}

/** Delete a screenshot (used to replace an existing one before re-upload). */
export async function deleteScreenshot(
  token: string,
  id: string,
): Promise<void> {
  await ascRequest(token, "DELETE", `/v1/appScreenshots/${id}`);
}
