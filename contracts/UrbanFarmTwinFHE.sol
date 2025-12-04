// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Project: UrbanFarmTwin_FHE
// Language: Solidity
// Notes: Lightweight FHE-enabled contract scaffold for encrypted urban farming digital twins.

// Import FHE primitives and a configuration stub.
import { FHE, euint32, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract UrbanFarmTwinFHE is SepoliaConfig {
    // Encrypted reading package
    struct EncryptedReading {
        uint256 id;
        euint32 encryptedTimestamp;
        euint32 encryptedTemperature;
        euint32 encryptedHumidity;
        euint32 encryptedCO2;
        euint32 encryptedLight;
        euint32 encryptedSoilMoisture;
    }

    // Encrypted digital twin snapshot
    struct EncryptedTwin {
        uint256 id;
        euint32 encryptedStateHash; // abstract encrypted fingerprint
        euint32 encryptedHealthScore; // encrypted metric
        uint256 lastUpdated;
    }

    // Decrypted twin result structure (local view only after decryption)
    struct DecryptedTwin {
        string stateSummary;
        uint32 healthScore;
        bool revealed;
    }

    // Encrypted recommendation package
    struct EncryptedRecommendation {
        uint256 id;
        euint32 encryptedWateringSchedule;
        euint32 encryptedNutrientPlan;
        euint32 encryptedLightAdjust;
        uint256 generatedAt;
    }

    // Decrypted recommendation (post-decryption)
    struct DecryptedRecommendation {
        string watering;
        string nutrients;
        string lightAdjust;
        bool revealed;
    }

    // Contract storage
    uint256 public readingCount;
    uint256 public twinCount;
    uint256 public recommendationCount;

    mapping(uint256 => EncryptedReading) public readings;
    mapping(uint256 => EncryptedTwin) public encryptedTwins;
    mapping(uint256 => DecryptedTwin) public decryptedTwins;

    mapping(uint256 => EncryptedRecommendation) public encryptedRecommendations;
    mapping(uint256 => DecryptedRecommendation) public decryptedRecommendations;

    // Aggregated encrypted metrics for community insights
    mapping(string => euint32) private encryptedMetricAggregates;
    string[] private metricKeys;

    // Track FHE decryption requests to local payloads
    mapping(uint256 => uint256) private requestToEntityId;
    mapping(uint256 => bytes32) private requestToTag;

    // Events
    event ReadingSubmitted(uint256 indexed id, uint256 indexed timestamp);
    event TwinUpdateRequested(uint256 indexed twinId, uint256 requestId);
    event TwinDecrypted(uint256 indexed twinId);
    event RecommendationRequested(uint256 indexed recId, uint256 requestId);
    event RecommendationDecrypted(uint256 indexed recId);

    // Modifier placeholder for access control
    modifier onlyOwnerOfTwin(uint256 twinId) {
        // Placeholder: real access control should be implemented off-chain or via mappings
        _;
    }

    // Submit a batch of encrypted sensor readings
    function submitEncryptedReading(
        euint32 encryptedTimestamp,
        euint32 encryptedTemperature,
        euint32 encryptedHumidity,
        euint32 encryptedCO2,
        euint32 encryptedLight,
        euint32 encryptedSoilMoisture
    ) public {
        readingCount += 1;
        uint256 rid = readingCount;

        readings[rid] = EncryptedReading({
            id: rid,
            encryptedTimestamp: encryptedTimestamp,
            encryptedTemperature: encryptedTemperature,
            encryptedHumidity: encryptedHumidity,
            encryptedCO2: encryptedCO2,
            encryptedLight: encryptedLight,
            encryptedSoilMoisture: encryptedSoilMoisture
        });

        emit ReadingSubmitted(rid, block.timestamp);
    }

    // Request a homomorphic update of a twin: server performs encrypted aggregation and returns new encrypted twin state
    function requestTwinUpdate(uint256 twinId, uint256[] calldata readingIds) public onlyOwnerOfTwin(twinId) {
        // Collect ciphertexts for aggregation
        uint256 n = readingIds.length;
        require(n > 0, "No readings provided");

        bytes32[] memory ciphertexts = new bytes32[](n * 6); // 6 encrypted fields per reading
        for (uint i = 0; i < n; i++) {
            EncryptedReading storage r = readings[readingIds[i]];
            uint256 base = i * 6;
            ciphertexts[base + 0] = FHE.toBytes32(r.encryptedTimestamp);
            ciphertexts[base + 1] = FHE.toBytes32(r.encryptedTemperature);
            ciphertexts[base + 2] = FHE.toBytes32(r.encryptedHumidity);
            ciphertexts[base + 3] = FHE.toBytes32(r.encryptedCO2);
            ciphertexts[base + 4] = FHE.toBytes32(r.encryptedLight);
            ciphertexts[base + 5] = FHE.toBytes32(r.encryptedSoilMoisture);
        }

        // Request an off-chain FHE aggregation and twin synthesis
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptTwinUpdate.selector);
        requestToEntityId[reqId] = twinId;
        requestToTag[reqId] = keccak256(abi.encodePacked("twin_update"));

        emit TwinUpdateRequested(twinId, reqId);
    }

    // Callback invoked by FHE runtime with decrypted twin update
    function decryptTwinUpdate(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 twinId = requestToEntityId[requestId];
        require(twinId != 0, "Invalid request id");

        // Validate FHE signatures/proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode results (e.g., [stateSummary, healthScore])
        string[] memory parts = abi.decode(cleartexts, (string[]));

        // Store decrypted twin (owner can view)
        decryptedTwins[twinId] = DecryptedTwin({
            stateSummary: parts.length > 0 ? parts[0] : "",
            healthScore: parts.length > 1 ? parseUint32(parts[1]) : 0,
            revealed: true
        });

        // Maintain or initialize encrypted twin record if absent
        if (encryptedTwins[twinId].id == 0) {
            twinCount += 1;
            encryptedTwins[twinId] = EncryptedTwin({
                id: twinId,
                encryptedStateHash: FHE.asEuint32(0),
                encryptedHealthScore: FHE.asEuint32(0),
                lastUpdated: block.timestamp
            });
        } else {
            encryptedTwins[twinId].lastUpdated = block.timestamp;
        }

        emit TwinDecrypted(twinId);
    }

    // Generate an encrypted recommendation request from existing encrypted twin state
    function submitEncryptedRecommendationRequest(
        euint32 encryptedWateringSchedule,
        euint32 encryptedNutrientPlan,
        euint32 encryptedLightAdjust
    ) public {
        recommendationCount += 1;
        uint256 rid = recommendationCount;

        encryptedRecommendations[rid] = EncryptedRecommendation({
            id: rid,
            encryptedWateringSchedule: encryptedWateringSchedule,
            encryptedNutrientPlan: encryptedNutrientPlan,
            encryptedLightAdjust: encryptedLightAdjust,
            generatedAt: block.timestamp
        });

        // Request decryption to reveal human-friendly recommendation to the owner
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(encryptedWateringSchedule);
        ciphertexts[1] = FHE.toBytes32(encryptedNutrientPlan);
        ciphertexts[2] = FHE.toBytes32(encryptedLightAdjust);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptRecommendation.selector);
        requestToEntityId[reqId] = rid;
        requestToTag[reqId] = keccak256(abi.encodePacked("recommendation"));

        emit RecommendationRequested(rid, reqId);
    }

    // Callback for decrypted recommendation text
    function decryptRecommendation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 recId = requestToEntityId[requestId];
        require(recId != 0, "Invalid request");

        // Verify proof material
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Expecting an array of strings: [watering, nutrients, lightAdjust]
        string[] memory items = abi.decode(cleartexts, (string[]));

        decryptedRecommendations[recId] = DecryptedRecommendation({
            watering: items.length > 0 ? items[0] : "",
            nutrients: items.length > 1 ? items[1] : "",
            lightAdjust: items.length > 2 ? items[2] : "",
            revealed: true
        });

        emit RecommendationDecrypted(recId);
    }

    // Aggregate encrypted metric into a named key (e.g., "avg_light" or "total_water_usage")
    function addEncryptedAggregate(string memory key, euint32 encryptedDelta) public {
        if (!FHE.isInitialized(encryptedMetricAggregates[key])) {
            encryptedMetricAggregates[key] = FHE.asEuint32(0);
            metricKeys.push(key);
        }
        encryptedMetricAggregates[key] = FHE.add(encryptedMetricAggregates[key], encryptedDelta);
    }

    // Request decryption for a specific aggregated metric
    function requestAggregateDecryption(string memory key) public {
        euint32 agg = encryptedMetricAggregates[key];
        require(FHE.isInitialized(agg), "Metric not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(agg);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptAggregate.selector);
        requestToEntityId[reqId] = uint256(keccak256(abi.encodePacked(key)));
        requestToTag[reqId] = keccak256(abi.encodePacked("aggregate"));
    }

    // Callback to handle decrypted aggregate results
    function decryptAggregate(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // Verify and decode
        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 keyHash = requestToEntityId[requestId];
        string memory key = findMetricKeyByHash(keyHash);

        // Decoded numeric result (uint32)
        uint32 value = abi.decode(cleartexts, (uint32));

        // Placeholder: store or emit; for privacy we avoid storing plaintext in contract state
        // Emit an event with the result in cleartext for the caller
        emitPlainAggregateResult(key, value);
    }

    // Helper: emit decrypted aggregate (limited plaintext emission)
    event PlainAggregateResult(string key, uint32 value);
    function emitPlainAggregateResult(string memory key, uint32 value) internal {
        emit PlainAggregateResult(key, value);
    }

    // View helpers
    function getEncryptedMetric(string memory key) public view returns (euint32) {
        return encryptedMetricAggregates[key];
    }

    function getDecryptedTwin(uint256 twinId) public view returns (string memory, uint32, bool) {
        DecryptedTwin storage d = decryptedTwins[twinId];
        return (d.stateSummary, d.healthScore, d.revealed);
    }

    function getDecryptedRecommendation(uint256 recId) public view returns (string memory, string memory, string memory, bool) {
        DecryptedRecommendation storage r = decryptedRecommendations[recId];
        return (r.watering, r.nutrients, r.lightAdjust, r.revealed);
    }

    // Utility functions

    // Convert a numeric string to uint32 (best-effort, no decimals)
    function parseUint32(string memory s) internal pure returns (uint32) {
        bytes memory b = bytes(s);
        uint32 result = 0;
        for (uint i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 48 && c <= 57) {
                result = result * 10 + (c - 48);
            } else {
                break;
            }
        }
        return result;
    }

    // Find metric key by keccak hash
    function findMetricKeyByHash(uint256 hash) internal view returns (string memory) {
        for (uint i = 0; i < metricKeys.length; i++) {
            if (uint256(keccak256(abi.encodePacked(metricKeys[i]))) == hash) {
                return metricKeys[i];
            }
        }
        revert("Metric key not found");
    }
}
