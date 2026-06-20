// Apple Vision OCR sidecar.
// Usage: swift visionOcr.swift <imagePath>
// Prints a JSON array of { text, confidence, x, y, w, h } where the box is
// normalized 0..1 with a top-left origin (web coordinate convention).
import Foundation
import Vision
import AppKit

func fail() -> Never {
    print("[]")
    exit(0)
}

guard CommandLine.arguments.count > 1 else { fail() }
let path = CommandLine.arguments[1]

guard
    let image = NSImage(contentsOfFile: path),
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let cgImage = bitmap.cgImage
else { fail() }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fail()
}

var rows: [[String: Any]] = []
for observation in (request.results ?? []) {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let box = observation.boundingBox // normalized, bottom-left origin
    rows.append([
        "text": candidate.string,
        "confidence": candidate.confidence,
        "x": box.origin.x,
        "y": 1.0 - (box.origin.y + box.size.height),
        "w": box.size.width,
        "h": box.size.height,
    ])
}

if let data = try? JSONSerialization.data(withJSONObject: rows),
   let json = String(data: data, encoding: .utf8) {
    print(json)
} else {
    print("[]")
}
