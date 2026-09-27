require("dotenv").config();

const fs = require("fs");
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai");

const client = new DocumentProcessorServiceClient();

async function testDocumentAI() {
  try {
    const processorName = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/processors/${process.env.DOCUMENT_AI_PROCESSOR_ID}`;

    console.log("Testing Google Document AI...");
    console.log("Project:", process.env.GCP_PROJECT_ID);
    console.log("Location:", process.env.GCP_LOCATION);
    console.log("Processor:", process.env.DOCUMENT_AI_PROCESSOR_ID);

    const [processor] = await client.getProcessor({
      name: processorName,
    });

    console.log("\n✅ Google Document AI connected successfully!");
    console.log("Processor name:", processor.name);
    console.log("Processor type:", processor.type);
    console.log("Processor state:", processor.state);
  } catch (error) {
    console.error("\n❌ Document AI connection failed.");
    console.error(error.message);
  }
}

testDocumentAI();