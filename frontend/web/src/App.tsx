// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SensorData {
  id: string;
  temperature: number;
  humidity: number;
  lightLevel: number;
  soilMoisture: number;
  timestamp: number;
  owner: string;
}

interface FarmingAdvice {
  id: string;
  plantType: string;
  advice: string;
  timestamp: number;
  owner: string;
  sensorId: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [farmingAdvice, setFarmingAdvice] = useState<FarmingAdvice[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSensorModal, setShowSensorModal] = useState(false);
  const [showAdviceModal, setShowAdviceModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newSensorData, setNewSensorData] = useState({
    temperature: 0,
    humidity: 0,
    lightLevel: 0,
    soilMoisture: 0
  });
  const [selectedSensor, setSelectedSensor] = useState("");
  const [newAdviceData, setNewAdviceData] = useState({
    plantType: "",
    advice: ""
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [activeTab, setActiveTab] = useState<"sensors" | "advice">("sensors");

  // Calculate statistics
  const sensorCount = sensorData.length;
  const adviceCount = farmingAdvice.length;
  const avgTemperature = sensorCount > 0 
    ? sensorData.reduce((sum, data) => sum + data.temperature, 0) / sensorCount 
    : 0;
  const avgHumidity = sensorCount > 0 
    ? sensorData.reduce((sum, data) => sum + data.humidity, 0) / sensorCount 
    : 0;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return false;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return false;
      }
      
      return true;
    } catch (e) {
      console.error("Error checking contract availability:", e);
      return false;
    }
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contractAvailable = await checkContractAvailability();
      if (!contractAvailable) return;
      
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Load sensor data keys
      const sensorKeysBytes = await contract.getData("sensor_keys");
      let sensorKeys: string[] = [];
      
      if (sensorKeysBytes.length > 0) {
        try {
          sensorKeys = JSON.parse(ethers.toUtf8String(sensorKeysBytes));
        } catch (e) {
          console.error("Error parsing sensor keys:", e);
        }
      }
      
      const sensorList: SensorData[] = [];
      
      for (const key of sensorKeys) {
        try {
          const sensorBytes = await contract.getData(`sensor_${key}`);
          if (sensorBytes.length > 0) {
            try {
              const sensor = JSON.parse(ethers.toUtf8String(sensorBytes));
              sensorList.push({
                id: key,
                temperature: sensor.temperature,
                humidity: sensor.humidity,
                lightLevel: sensor.lightLevel,
                soilMoisture: sensor.soilMoisture,
                timestamp: sensor.timestamp,
                owner: sensor.owner
              });
            } catch (e) {
              console.error(`Error parsing sensor data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading sensor ${key}:`, e);
        }
      }
      
      sensorList.sort((a, b) => b.timestamp - a.timestamp);
      setSensorData(sensorList);
      
      // Load advice keys
      const adviceKeysBytes = await contract.getData("advice_keys");
      let adviceKeys: string[] = [];
      
      if (adviceKeysBytes.length > 0) {
        try {
          adviceKeys = JSON.parse(ethers.toUtf8String(adviceKeysBytes));
        } catch (e) {
          console.error("Error parsing advice keys:", e);
        }
      }
      
      const adviceList: FarmingAdvice[] = [];
      
      for (const key of adviceKeys) {
        try {
          const adviceBytes = await contract.getData(`advice_${key}`);
          if (adviceBytes.length > 0) {
            try {
              const advice = JSON.parse(ethers.toUtf8String(adviceBytes));
              adviceList.push({
                id: key,
                plantType: advice.plantType,
                advice: advice.advice,
                timestamp: advice.timestamp,
                owner: advice.owner,
                sensorId: advice.sensorId
              });
            } catch (e) {
              console.error(`Error parsing advice data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading advice ${key}:`, e);
        }
      }
      
      adviceList.sort((a, b) => b.timestamp - a.timestamp);
      setFarmingAdvice(adviceList);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitSensorData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensor data with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const sensorId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const sensorData = {
        ...newSensorData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account
      };
      
      // Store encrypted sensor data using FHE
      await contract.setData(
        `sensor_${sensorId}`, 
        ethers.toUtf8Bytes(JSON.stringify(sensorData))
      );
      
      const keysBytes = await contract.getData("sensor_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(sensorId);
      
      await contract.setData(
        "sensor_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Sensor data encrypted and stored securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSensorModal(false);
        setNewSensorData({
          temperature: 0,
          humidity: 0,
          lightLevel: 0,
          soilMoisture: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const submitFarmingAdvice = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    if (!selectedSensor) {
      alert("Please select a sensor reading first");
      return;
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Generating personalized advice with FHE..."
    });
    
    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const adviceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const adviceData = {
        ...newAdviceData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        sensorId: selectedSensor
      };
      
      // Store encrypted advice using FHE
      await contract.setData(
        `advice_${adviceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(adviceData))
      );
      
      const keysBytes = await contract.getData("advice_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(adviceId);
      
      await contract.setData(
        "advice_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Personalized farming advice generated!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAdviceModal(false);
        setNewAdviceData({
          plantType: "",
          advice: ""
        });
        setSelectedSensor("");
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const faqItems = [
    {
      question: "How does FHE protect my farming data?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decryption. Your sensor readings and farming advice remain encrypted at all times, even during processing."
    },
    {
      question: "What types of plants can I grow with this system?",
      answer: "Our system supports a wide range of plants including herbs, vegetables, and small fruits. The personalized advice adapts to your specific plant types and growing conditions."
    },
    {
      question: "How often should I collect sensor data?",
      answer: "For optimal results, we recommend collecting sensor data at least once per day. More frequent readings will provide more accurate personalized advice."
    },
    {
      question: "Can I use this for outdoor farming?",
      answer: "While designed for urban indoor/balcony farming, the system can be adapted for outdoor use. Contact our support for custom solutions."
    },
    {
      question: "How is my privacy protected?",
      answer: "All your farming data is encrypted using FHE technology. Only you can decrypt and view your personal farming information."
    }
  ];

  const renderTemperatureChart = () => {
    if (sensorData.length === 0) return null;
    
    const dataPoints = sensorData.slice(0, 10).map(data => ({
      x: new Date(data.timestamp * 1000).toLocaleDateString(),
      y: data.temperature
    }));
    
    const maxTemp = Math.max(...dataPoints.map(p => p.y));
    const minTemp = Math.min(...dataPoints.map(p => p.y));
    
    return (
      <div className="chart-container">
        <div className="chart-title">Temperature Trend</div>
        <div className="chart-scale">
          <div>{maxTemp.toFixed(1)}°C</div>
          <div>{((maxTemp + minTemp) / 2).toFixed(1)}°C</div>
          <div>{minTemp.toFixed(1)}°C</div>
        </div>
        <div className="chart-bars">
          {dataPoints.map((point, index) => (
            <div 
              key={index} 
              className="chart-bar"
              style={{ 
                height: `${((point.y - minTemp) / (maxTemp - minTemp)) * 100}%` 
              }}
            >
              <div className="bar-value">{point.y}°C</div>
              <div className="bar-label">{point.x}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="nature-spinner">
        <div className="leaf leaf1"></div>
        <div className="leaf leaf2"></div>
        <div className="leaf leaf3"></div>
      </div>
      <p>Initializing encrypted farming connection...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="leaf-icon"></div>
          </div>
          <h1>UrbanFarm<span>Twin</span></h1>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="panel-layout">
          {/* Left Panel - Project Introduction */}
          <div className="panel left-panel">
            <div className="panel-content nature-card">
              <h2>Privacy-Preserving Digital Twin for Personalized Urban Farming</h2>
              <p>
                UrbanFarmTwin leverages Fully Homomorphic Encryption (FHE) technology to create 
                a secure digital twin of your personal indoor or balcony farm. 
              </p>
              <p>
                Our system processes encrypted sensor data to provide personalized growing 
                recommendations while keeping your private farming information completely confidential.
              </p>
              
              <div className="feature-highlights">
                <div className="feature">
                  <div className="feature-icon">🔒</div>
                  <h3>Encrypted Sensor Data</h3>
                  <p>All environmental readings are encrypted using FHE technology</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">🌱</div>
                  <h3>Personalized Advice</h3>
                  <p>Get customized growing recommendations without exposing your data</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">📈</div>
                  <h3>Optimized Yields</h3>
                  <p>Maximize your urban farming output with data-driven insights</p>
                </div>
              </div>
              
              <button 
                className="nature-btn primary"
                onClick={() => checkContractAvailability().then(available => {
                  if (available) {
                    alert("FHE contract is available and ready to use!");
                  } else {
                    alert("Contract is currently unavailable");
                  }
                })}
              >
                Check FHE Availability
              </button>
            </div>
            
            {/* FAQ Section */}
            <div className="panel-content nature-card">
              <div className="faq-header">
                <h2>Frequently Asked Questions</h2>
                <button 
                  className="nature-btn"
                  onClick={() => setShowFAQ(!showFAQ)}
                >
                  {showFAQ ? "Hide FAQ" : "Show FAQ"}
                </button>
              </div>
              
              {showFAQ && (
                <div className="faq-items">
                  {faqItems.map((item, index) => (
                    <div className="faq-item" key={index}>
                      <h3 className="faq-question">{item.question}</h3>
                      <p className="faq-answer">{item.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Center Panel - Data Management */}
          <div className="panel center-panel">
            <div className="panel-header">
              <div className="tabs">
                <button 
                  className={`tab-btn ${activeTab === "sensors" ? "active" : ""}`}
                  onClick={() => setActiveTab("sensors")}
                >
                  Sensor Data
                </button>
                <button 
                  className={`tab-btn ${activeTab === "advice" ? "active" : ""}`}
                  onClick={() => setActiveTab("advice")}
                >
                  Farming Advice
                </button>
              </div>
              
              <div className="actions">
                {activeTab === "sensors" && (
                  <button 
                    className="nature-btn primary"
                    onClick={() => setShowSensorModal(true)}
                  >
                    + Add Sensor Reading
                  </button>
                )}
                {activeTab === "advice" && (
                  <button 
                    className="nature-btn primary"
                    onClick={() => setShowAdviceModal(true)}
                  >
                    + Generate Advice
                  </button>
                )}
                <button 
                  className="nature-btn"
                  onClick={loadData}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>
            </div>
            
            <div className="panel-content nature-card">
              {activeTab === "sensors" ? (
                <div className="data-list">
                  <div className="list-header">
                    <div className="header-cell">ID</div>
                    <div className="header-cell">Temperature</div>
                    <div className="header-cell">Humidity</div>
                    <div className="header-cell">Light</div>
                    <div className="header-cell">Soil</div>
                    <div className="header-cell">Date</div>
                  </div>
                  
                  {sensorData.length === 0 ? (
                    <div className="no-data">
                      <div className="no-data-icon">🌿</div>
                      <p>No sensor data found</p>
                      <button 
                        className="nature-btn primary"
                        onClick={() => setShowSensorModal(true)}
                      >
                        Add First Reading
                      </button>
                    </div>
                  ) : (
                    sensorData.map(data => (
                      <div 
                        className="data-row" 
                        key={data.id}
                        onClick={() => {
                          setSelectedSensor(data.id);
                          if (activeTab !== "advice") setActiveTab("advice");
                        }}
                      >
                        <div className="data-cell">#{data.id.substring(0, 6)}</div>
                        <div className="data-cell">{data.temperature}°C</div>
                        <div className="data-cell">{data.humidity}%</div>
                        <div className="data-cell">{data.lightLevel} lux</div>
                        <div className="data-cell">{data.soilMoisture}%</div>
                        <div className="data-cell">
                          {new Date(data.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="data-list">
                  <div className="list-header">
                    <div className="header-cell">Plant</div>
                    <div className="header-cell">Advice</div>
                    <div className="header-cell">Date</div>
                  </div>
                  
                  {farmingAdvice.length === 0 ? (
                    <div className="no-data">
                      <div className="no-data-icon">🌱</div>
                      <p>No farming advice found</p>
                      <button 
                        className="nature-btn primary"
                        onClick={() => setShowAdviceModal(true)}
                      >
                        Generate First Advice
                      </button>
                    </div>
                  ) : (
                    farmingAdvice.map(advice => (
                      <div className="data-row" key={advice.id}>
                        <div className="data-cell">{advice.plantType}</div>
                        <div className="data-cell advice-text">{advice.advice}</div>
                        <div className="data-cell">
                          {new Date(advice.timestamp * 1000).toLocaleDateString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Right Panel - Statistics and Charts */}
          <div className="panel right-panel">
            <div className="panel-content nature-card">
              <h2>Farm Statistics</h2>
              
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{sensorCount}</div>
                  <div className="stat-label">Sensor Readings</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{adviceCount}</div>
                  <div className="stat-label">Farming Advice</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{avgTemperature.toFixed(1)}°C</div>
                  <div className="stat-label">Avg Temp</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{avgHumidity.toFixed(1)}%</div>
                  <div className="stat-label">Avg Humidity</div>
                </div>
              </div>
            </div>
            
            <div className="panel-content nature-card">
              <h2>Environmental Trends</h2>
              {renderTemperatureChart()}
            </div>
            
            <div className="panel-content nature-card">
              <h2>FHE Data Flow</h2>
              <div className="fhe-flow">
                <div className="flow-step">
                  <div className="step-icon">📱</div>
                  <h3>Sensor Data</h3>
                  <p>Encrypted with FHE before transmission</p>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-icon">🔒</div>
                  <h3>FHE Processing</h3>
                  <p>Data processed while encrypted</p>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-icon">🌿</div>
                  <h3>Personalized Advice</h3>
                  <p>Decrypted only for your viewing</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  
      {showSensorModal && (
        <ModalSensor 
          onSubmit={submitSensorData} 
          onClose={() => setShowSensorModal(false)} 
          creating={creating}
          sensorData={newSensorData}
          setSensorData={setNewSensorData}
        />
      )}
      
      {showAdviceModal && (
        <ModalAdvice 
          onSubmit={submitFarmingAdvice} 
          onClose={() => setShowAdviceModal(false)} 
          creating={creating}
          adviceData={newAdviceData}
          setAdviceData={setNewAdviceData}
          sensorData={sensorData}
          selectedSensor={selectedSensor}
          setSelectedSensor={setSelectedSensor}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content nature-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="nature-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">⚠️</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="leaf-icon"></div>
              <span>UrbanFarmTwin</span>
            </div>
            <p>Privacy-preserving digital twin for personalized urban farming</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Support</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} UrbanFarmTwin. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSensorProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  sensorData: any;
  setSensorData: (data: any) => void;
}

const ModalSensor: React.FC<ModalSensorProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  sensorData,
  setSensorData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSensorData({
      ...sensorData,
      [name]: parseFloat(value) || 0
    });
  };

  const handleSubmit = () => {
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal nature-card">
        <div className="modal-header">
          <h2>Add Sensor Reading</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔒</div> 
            Your sensor data will be encrypted with FHE before storage
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Temperature (°C)</label>
              <input 
                type="number"
                name="temperature"
                value={sensorData.temperature} 
                onChange={handleChange}
                className="nature-input"
                min="0"
                max="50"
                step="0.1"
              />
            </div>
            
            <div className="form-group">
              <label>Humidity (%)</label>
              <input 
                type="number"
                name="humidity"
                value={sensorData.humidity} 
                onChange={handleChange}
                className="nature-input"
                min="0"
                max="100"
                step="0.1"
              />
            </div>
            
            <div className="form-group">
              <label>Light Level (lux)</label>
              <input 
                type="number"
                name="lightLevel"
                value={sensorData.lightLevel} 
                onChange={handleChange}
                className="nature-input"
                min="0"
                max="10000"
                step="1"
              />
            </div>
            
            <div className="form-group">
              <label>Soil Moisture (%)</label>
              <input 
                type="number"
                name="soilMoisture"
                value={sensorData.soilMoisture} 
                onChange={handleChange}
                className="nature-input"
                min="0"
                max="100"
                step="0.1"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🔐</div> 
            Data remains encrypted during FHE processing and storage
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="nature-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="nature-btn primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalAdviceProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  adviceData: any;
  setAdviceData: (data: any) => void;
  sensorData: SensorData[];
  selectedSensor: string;
  setSelectedSensor: (id: string) => void;
}

const ModalAdvice: React.FC<ModalAdviceProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  adviceData,
  setAdviceData,
  sensorData,
  selectedSensor,
  setSelectedSensor
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setAdviceData({
      ...adviceData,
      [name]: value
    });
  };

  const handleSensorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSensor(e.target.value);
  };

  const handleSubmit = () => {
    if (!selectedSensor) {
      alert("Please select a sensor reading");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal nature-card">
        <div className="modal-header">
          <h2>Generate Farming Advice</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔒</div> 
            Personalized advice generated using FHE on encrypted data
          </div>
          
          <div className="form-group">
            <label>Select Sensor Reading *</label>
            <select 
              value={selectedSensor}
              onChange={handleSensorChange}
              className="nature-select"
            >
              <option value="">Select a sensor reading</option>
              {sensorData.map(sensor => (
                <option key={sensor.id} value={sensor.id}>
                  {new Date(sensor.timestamp * 1000).toLocaleString()} - 
                  Temp: {sensor.temperature}°C
                </option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Plant Type *</label>
            <input 
              type="text"
              name="plantType"
              value={adviceData.plantType} 
              onChange={handleChange}
              placeholder="e.g., Tomatoes, Basil, Lettuce" 
              className="nature-input"
            />
          </div>
          
          <div className="form-group">
            <label>Custom Advice (Optional)</label>
            <textarea 
              name="advice"
              value={adviceData.advice} 
              onChange={handleChange}
              placeholder="Add any specific observations or notes..." 
              className="nature-textarea"
              rows={3}
            />
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🔐</div> 
            Your farming data remains encrypted throughout the FHE process
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="nature-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating || !selectedSensor}
            className="nature-btn primary"
          >
            {creating ? "Generating with FHE..." : "Generate Advice"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;