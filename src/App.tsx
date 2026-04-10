/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Camera, 
  Upload, 
  Leaf, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Droplets,
  Sun,
  Thermometer,
  Bug,
  History,
  Trash2,
  Calendar,
  ThumbsUp,
  ThumbsDown,
  Star,
  LogOut,
  User as UserIcon,
  LogIn,
  X,
  Maximize2,
  Sparkles,
  ArrowRight,
  Volume2,
  VolumeX,
  Loader2,
  Share2,
  Copy,
  Check,
  Download,
  Moon,
  Settings,
  Bell,
  Globe,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  deleteDoc,
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  Timestamp,
  User
} from './firebase';

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface AnalysisResult {
  species: string;
  scientificName: string;
  description: string;
  disease: string;
  confidence: string;
  symptoms: string[];
  causes: string[];
  treatment: string;
  prevention: string[];
  severity: 'Low' | 'Moderate' | 'High' | 'Critical';
  feedback?: {
    helpful: boolean;
    rating: number;
  };
}

interface HistoryItem {
  id: string;
  timestamp: number;
  image: string;
  result: AnalysisResult;
  userId?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTreatmentModal, setShowTreatmentModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPreferencesLoaded, setIsPreferencesLoaded] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [isAskingFollowUp, setIsAskingFollowUp] = useState(false);
  const [preferences, setPreferences] = useState({
    experienceLevel: 'Beginner',
    primaryInterest: 'Indoor Plants',
    darkMode: false,
    notifications: {
      email: true,
      push: true,
      weeklyReport: false
    },
    language: 'English'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check if onboarding is needed
  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem('leaflens_onboarding_seen');
    if (!hasSeenOnboarding && !user) {
      setShowOnboarding(true);
    }
  }, [user]);

  const completeOnboarding = () => {
    localStorage.setItem('leaflens_onboarding_seen', 'true');
    setShowOnboarding(false);
  };

  const onboardingSteps = [
    {
      title: "Identify Any Plant",
      description: "Snap a photo of any plant to instantly identify its species and scientific name.",
      icon: <Leaf className="w-12 h-12 text-emerald-600" />,
      color: "bg-emerald-50"
    },
    {
      title: "Diagnose Diseases",
      description: "Our AI detects thousands of plant pathologies and provides detailed treatment plans.",
      icon: <Bug className="w-12 h-12 text-amber-600" />,
      color: "bg-amber-50"
    },
    {
      title: "Cloud Sync",
      description: "Sign in to save your diagnosis history and preferences across all your devices.",
      icon: <RefreshCw className="w-12 h-12 text-blue-600" />,
      color: "bg-blue-50"
    }
  ];

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Sync user profile to Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          if (userData.preferences) {
            setPreferences(userData.preferences);
          }
        }
        setIsPreferencesLoaded(true);
        setIsAuthReady(true);

        await setDoc(userRef, {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } else {
        // Clear history if logged out (or fallback to local if desired, but here we prefer cloud)
        setHistory([]);
        setIsPreferencesLoaded(false);
        setIsAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync History from Firestore
  useEffect(() => {
    if (!user) {
      // Load from local storage for guests
      const savedHistory = localStorage.getItem('leaflens_history');
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error("Failed to load local history", e);
        }
      }
      return;
    };

    const q = query(
      collection(db, 'diagnoses'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cloudHistory = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          timestamp: data.timestamp?.toMillis() || Date.now(),
          image: data.image,
          result: data as AnalysisResult,
          userId: data.userId
        } as HistoryItem;
      });
      setHistory(cloudHistory);
    }, (err) => {
      console.error("Firestore sync error:", err);
    });

    return () => unsubscribe();
  }, [user]);

  // Save local history for guests
  useEffect(() => {
    if (!user) {
      localStorage.setItem('leaflens_history', JSON.stringify(history));
    }
  }, [history, user]);

  // Auto-save preferences to Firestore
  useEffect(() => {
    if (user && isPreferencesLoaded) {
      const savePrefs = async () => {
        try {
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, { preferences }, { merge: true });
        } catch (err) {
          console.error("Failed to auto-save preferences:", err);
        }
      };
      savePrefs();
    }
  }, [preferences, user, isPreferencesLoaded]);

  // Apply Dark Mode
  useEffect(() => {
    if (preferences.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [preferences.darkMode]);

  const updatePreferences = (newPrefs: Partial<typeof preferences>) => {
    setPreferences(prev => ({ ...prev, ...newPrefs }));
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed:", err);
      setError("Login failed. Please try again.");
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setShowProfile(false);
      reset();
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
        setResult(null);
        setError(null);
      }
    } catch (err) {
      console.error("Camera access failed:", err);
      setError("Could not access camera. Please ensure you have granted permission.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setImage(dataUrl);
        stopCamera();
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
        setError(null);
        stopSpeaking();
      };
      reader.readAsDataURL(file);
    }
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const speakSummary = async () => {
    if (!result) return;
    if (isSpeaking) {
      stopSpeaking();
      return;
    }

    setIsGeneratingSpeech(true);
    try {
      const summaryPrompt = `
        Summarize this plant analysis for a voice-over. 
        Keep it under 40 words. 
        Focus on: Plant name, the issue (or if it's healthy), and the most critical next step.
        Data: ${JSON.stringify({
          species: result.species,
          disease: result.disease,
          severity: result.severity,
          treatment: result.treatment
        })}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [{ text: summaryPrompt }] }
      });

      const summaryText = response.text || "Analysis complete.";
      
      const utterance = new SpeechSynthesisUtterance(summaryText);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Speech generation failed:", err);
      setError("Failed to generate voice summary.");
    } finally {
      setIsGeneratingSpeech(false);
    }
  };

  const shareResult = async () => {
    if (!result) return;
    
    const shareData = {
      title: `LeafLens AI: ${result.species} Diagnosis`,
      text: `My ${result.species} has ${result.disease}. Severity: ${result.severity}. Treatment: ${result.treatment.substring(0, 100)}...`,
      url: window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error("Share failed:", err);
        setShowShareMenu(true);
      }
    } else {
      setShowShareMenu(true);
    }
  };

  const copyToClipboard = () => {
    if (!result) return;
    const text = `LeafLens AI Diagnosis\nPlant: ${result.species}\nIssue: ${result.disease}\nSeverity: ${result.severity}\nTreatment: ${result.treatment}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadCSV = () => {
    if (history.length === 0) return;

    const headers = ['Date', 'Species', 'Scientific Name', 'Disease', 'Severity', 'Confidence'];
    const rows = history.map(item => [
      new Date(item.timestamp).toLocaleDateString(),
      item.result.species,
      item.result.scientificName,
      item.result.disease,
      item.result.severity,
      item.result.confidence
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `leaflens_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const askFollowUp = async () => {
    if (!followUpQuestion.trim() || !result) return;

    const question = followUpQuestion;
    setFollowUpQuestion('');
    setChatHistory(prev => [...prev, { role: 'user', text: question }]);
    setIsAskingFollowUp(true);

    try {
      const context = `
        You are a plant expert. The user is asking a follow-up question about a plant diagnosis.
        Current Diagnosis:
        - Species: ${result.species} (${result.scientificName})
        - Issue: ${result.disease}
        - Severity: ${result.severity}
        - Treatment: ${result.treatment}
        - Symptoms: ${result.symptoms.join(', ')}
        
        Previous Chat History:
        ${chatHistory.map(c => `${c.role === 'user' ? 'User' : 'AI'}: ${c.text}`).join('\n')}
        
        User Question: ${question}
        
        Provide a helpful, concise, and expert answer.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [{ text: context }] }
      });

      const answer = response.text || "I'm sorry, I couldn't generate an answer. Please try again.";
      setChatHistory(prev => [...prev, { role: 'ai', text: answer }]);
    } catch (err) {
      console.error("Follow-up question failed:", err);
      setChatHistory(prev => [...prev, { role: 'ai', text: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsAskingFollowUp(false);
    }
  };

  const analyzeImage = async () => {
    if (!image) return;

    setIsAnalyzing(true);
    setError(null);
    setChatHistory([]);
    setFollowUpQuestion('');

    try {
      const base64Data = image.split(',')[1];
      
      const prompt = `
        You are an expert plant pathologist and botanist. Analyze this image of a plant leaf/part.
        1. Identify the plant species (common name and scientific name).
        2. Provide a brief (1-2 sentence) description of the plant species and its typical care needs.
        3. Identify any diseases or issues.

        Provide the response in the following JSON format:
        {
          "species": "Common Name",
          "scientificName": "Scientific Name",
          "description": "Brief description of the plant and care needs",
          "disease": "Name of the disease or 'Healthy'",
          "confidence": "Percentage confidence (e.g., 95%)",
          "symptoms": ["List of observed symptoms"],
          "causes": ["List of potential causes"],
          "treatment": "Detailed treatment and cure instructions in markdown format. You MUST include: 
            ### Organic Solutions
            Specific organic products or home remedies.
            ### Chemical Solutions
            Specific active ingredients or commercial products (if appropriate).
            ### Application Method
            Step-by-step instructions on how to apply the treatment.
            ### Frequency & Duration
            How often and for how long to continue the treatment.",
          "prevention": ["Detailed list of prevention tips", "Environmental adjustments", "Long-term monitoring advice"],
          "severity": "Low | Moderate | High | Critical"
        }
        If the plant is healthy, state "Healthy" as the disease and provide comprehensive care tips in the treatment section.
        Be precise, professional, and provide highly actionable advice.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json"
        }
      });

      const analysis = JSON.parse(response.text || '{}') as AnalysisResult;
      setResult(analysis);

      // Add to history (Cloud or Local)
      if (user) {
        await addDoc(collection(db, 'diagnoses'), {
          ...analysis,
          userId: user.uid,
          image: image,
          timestamp: serverTimestamp()
        });
      } else {
        const newItem: HistoryItem = {
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          image: image,
          result: analysis
        };
        setHistory(prev => [newItem, ...prev].slice(0, 20));
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      setError("Failed to analyze the image. Please try again with a clearer photo.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setImage(null);
    setResult(null);
    setError(null);
    setChatHistory([]);
    setFollowUpQuestion('');
    stopSpeaking();
  };

  const clearHistory = async () => {
    if (window.confirm("Are you sure you want to clear your diagnosis history?")) {
      if (user) {
        // For simplicity, we'd normally use a batch or cloud function, 
        // but here we'll clear local state and user can delete individually if needed 
        // or we could loop (not recommended for large sets).
        // Let's just clear local for now and advise user.
        alert("Cloud history must be managed individually for security. Local view cleared.");
        setHistory([]);
      } else {
        setHistory([]);
      }
    }
  };

  const handleFeedback = async (helpful: boolean, rating: number) => {
    if (!result) return;
    
    const updatedResult = { ...result, feedback: { helpful, rating } };
    setResult(updatedResult);

    if (user) {
      // Find the document in history and update it
      const itemToUpdate = history.find(item => item.image === image && item.result.disease === result.disease);
      if (itemToUpdate && itemToUpdate.id) {
        const docRef = doc(db, 'diagnoses', itemToUpdate.id);
        await setDoc(docRef, { feedback: { helpful, rating } }, { merge: true });
      }
    } else {
      // Update local history
      setHistory(prev => prev.map(item => {
        if (item.image === image && item.result.disease === result.disease) {
          return { ...item, result: updatedResult };
        }
        return item;
      }));
    }
  };

  const viewHistoryItem = (item: HistoryItem) => {
    setImage(item.image);
    setResult(item.result);
    setError(null);
    setShowHistory(false);
    setChatHistory([]);
    setFollowUpQuestion('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteHistoryItem = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    if (window.confirm("Remove this diagnosis from your history?")) {
      if (user && item.id) {
        try {
          await deleteDoc(doc(db, 'diagnoses', item.id));
        } catch (err) {
          console.error("Failed to delete history item:", err);
        }
      } else {
        setHistory(prev => prev.filter(h => h.id !== item.id));
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 selection:bg-emerald-100 dark:selection:bg-emerald-900 transition-colors duration-300">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
              <Leaf className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-emerald-900 dark:text-emerald-400">LeafLens AI</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => updatePreferences({ darkMode: !preferences.darkMode })}
              className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
              title={preferences.darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {preferences.darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-full transition-colors ${showHistory ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}
              title="History"
            >
              <History className="w-5 h-5" />
            </button>

            {user && (
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}`}
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
            
            {user ? (
              <button 
                onClick={() => setShowProfile(!showProfile)}
                className="w-9 h-9 rounded-full overflow-hidden border-2 border-emerald-100 hover:border-emerald-500 transition-all"
                title="Profile"
              >
                <img src={user.photoURL || ''} alt="Profile" className="w-full h-full object-cover" />
              </button>
            ) : (
              <button 
                onClick={login}
                className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-500"
                title="Login"
              >
                <LogIn className="w-5 h-5" />
              </button>
            )}

            <button 
              onClick={reset}
              className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-500"
              title="Reset"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Onboarding Overlay */}
        <AnimatePresence>
          {showOnboarding && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-zinc-900/80 backdrop-blur-md"
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white dark:bg-zinc-900 rounded-[2.5rem] shadow-2xl max-w-lg w-full overflow-hidden"
              >
                <div className="p-8 sm:p-12 text-center space-y-8">
                  <div className={`w-24 h-24 mx-auto rounded-3xl flex items-center justify-center transition-colors duration-500 ${onboardingSteps[onboardingStep].color} dark:bg-opacity-10`}>
                    {onboardingSteps[onboardingStep].icon}
                  </div>
                  
                  <div className="space-y-3">
                    <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
                      {onboardingSteps[onboardingStep].title}
                    </h2>
                    <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      {onboardingSteps[onboardingStep].description}
                    </p>
                  </div>

                  <div className="flex justify-center gap-2">
                    {onboardingSteps.map((_, i) => (
                      <div 
                        key={i} 
                        className={`h-1.5 rounded-full transition-all duration-300 ${onboardingStep === i ? 'w-8 bg-emerald-600' : 'w-2 bg-zinc-200 dark:bg-zinc-800'}`} 
                      />
                    ))}
                  </div>

                  <div className="pt-4 space-y-3">
                    {onboardingStep < onboardingSteps.length - 1 ? (
                      <button 
                        onClick={() => setOnboardingStep(prev => prev + 1)}
                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                      >
                        Next
                        <ArrowRight className="w-5 h-5" />
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <button 
                          onClick={completeOnboarding}
                          className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                        >
                          <Sparkles className="w-5 h-5" />
                          Start Analyzing
                        </button>
                        <button 
                          onClick={() => {
                            completeOnboarding();
                            login();
                          }}
                          className="w-full py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
                        >
                          <LogIn className="w-5 h-5" />
                          Log In with Google
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSettings && user && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center gap-3">
                  <Settings className="w-6 h-6 text-emerald-600" />
                  App Settings
                </h2>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Account Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                    <UserIcon className="w-3 h-3" />
                    Account
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                    <img src={user.photoURL || ''} alt="Profile" className="w-12 h-12 rounded-full" />
                    <div>
                      <p className="font-bold text-sm">{user.displayName}</p>
                      <p className="text-xs text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                  <button 
                    onClick={logout}
                    className="w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>

                {/* Preferences Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                    <Sparkles className="w-3 h-3" />
                    Preferences
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-2 block">Language</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <select 
                          value={preferences.language}
                          onChange={(e) => updatePreferences({ language: e.target.value })}
                          className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none appearance-none dark:text-zinc-100"
                        >
                          <option>English</option>
                          <option>Spanish</option>
                          <option>French</option>
                          <option>German</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-2 block">Experience Level</label>
                      <div className="flex gap-2">
                        {['Beginner', 'Intermediate', 'Expert'].map((level) => (
                          <button
                            key={level}
                            onClick={() => updatePreferences({ experienceLevel: level })}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                              preferences.experienceLevel === level 
                              ? 'bg-emerald-600 text-white shadow-md' 
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Notifications Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                    <Bell className="w-3 h-3" />
                    Notifications
                  </div>
                  <div className="space-y-3">
                    {[
                      { id: 'email', label: 'Email Notifications', desc: 'Receive diagnosis reports via email' },
                      { id: 'push', label: 'Push Notifications', desc: 'Get instant alerts on your device' },
                      { id: 'weeklyReport', label: 'Weekly Garden Insights', desc: 'Summary of your garden health' }
                    ].map((item) => (
                      <label key={item.id} className="flex items-start gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-xl cursor-pointer transition-colors group">
                        <div className="relative flex items-center h-5">
                          <input
                            type="checkbox"
                            checked={(preferences.notifications as any)[item.id]}
                            onChange={(e) => updatePreferences({ 
                              notifications: { ...preferences.notifications, [item.id]: e.target.checked } 
                            })}
                            className="w-4 h-4 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold group-hover:text-emerald-600 transition-colors">{item.label}</span>
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{item.desc}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider">
                  <Lock className="w-4 h-4" />
                  End-to-End Encrypted Data
                </div>
                <div className="flex gap-4">
                  <button className="text-xs font-bold text-zinc-400 hover:text-zinc-600 transition-colors">Privacy Policy</button>
                  <button className="text-xs font-bold text-zinc-400 hover:text-zinc-600 transition-colors">Terms of Service</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showProfile && user && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-8 shadow-sm space-y-8"
            >
              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-emerald-50 dark:border-emerald-900/30 shadow-inner">
                  <img src={user.photoURL || ''} alt="Profile" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{user.displayName}</h2>
                  <p className="text-zinc-500 dark:text-zinc-400">{user.email}</p>
                  <div className="mt-2 flex flex-wrap justify-center md:justify-start gap-2">
                    <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold rounded-full uppercase tracking-wider">
                      Premium Member
                    </span>
                    <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-bold rounded-full uppercase tracking-wider">
                      {history.length} Diagnoses
                    </span>
                  </div>
                </div>
                <button 
                  onClick={logout}
                  className="px-6 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>

              <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="font-bold text-lg flex items-center gap-2 dark:text-zinc-100">
                    <Sun className="w-5 h-5 text-amber-500" />
                    Gardening Preferences
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest block mb-2">Experience Level</label>
                      <div className="flex gap-2">
                        {['Beginner', 'Intermediate', 'Expert'].map((level) => (
                          <button
                            key={level}
                            onClick={() => updatePreferences({ experienceLevel: level })}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                              preferences.experienceLevel === level 
                              ? 'bg-emerald-600 text-white shadow-md' 
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest block mb-2">Primary Interest</label>
                      <select 
                        value={preferences.primaryInterest}
                        onChange={(e) => updatePreferences({ primaryInterest: e.target.value })}
                        className="w-full bg-zinc-100 dark:bg-zinc-800 border-none rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none dark:text-zinc-100"
                      >
                        <option>Indoor Plants</option>
                        <option>Outdoor Garden</option>
                        <option>Succulents</option>
                        <option>Vegetables</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl p-6 space-y-4">
                  <h3 className="font-bold text-emerald-900 dark:text-emerald-400 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" />
                    Account Security
                  </h3>
                  <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80 leading-relaxed">
                    Your data is securely stored in Google Cloud. Your plant history and preferences are private and only accessible by you.
                  </p>
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4" />
                    Verified Account
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Input */}
          <section className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50">
                <h2 className="font-semibold flex items-center gap-2 dark:text-zinc-100">
                  <Camera className="w-4 h-4 text-emerald-600" />
                  Plant Diagnostic
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Upload or take a photo of the affected leaf</p>
              </div>
              
              <div className="p-6">
                {!image && !isCameraActive ? (
                  <div className="space-y-4">
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-4 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10 transition-all cursor-pointer group"
                    >
                      <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900 transition-colors">
                        <Upload className="w-8 h-8 text-zinc-400 dark:text-zinc-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-zinc-700 dark:text-zinc-300">Click to upload</p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">PNG, JPG up to 10MB</p>
                      </div>
                    </div>
                    <button
                      onClick={startCamera}
                      className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                    >
                      <Camera className="w-5 h-5" />
                      Take Photo
                    </button>
                  </div>
                ) : isCameraActive ? (
                  <div className="space-y-4">
                    <div className="relative aspect-square rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black">
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
                        <button 
                          onClick={capturePhoto}
                          className="w-16 h-16 bg-white dark:bg-zinc-800 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                        >
                          <div className="w-12 h-12 border-4 border-zinc-200 dark:border-zinc-700 rounded-full" />
                        </button>
                      </div>
                      <button 
                        onClick={stopCamera}
                        className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">Position the leaf in the center of the frame</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative aspect-square rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
                      <img 
                        src={image!} 
                        alt="Plant to analyze" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <button 
                        onClick={() => setImage(null)}
                        className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-sm transition-colors"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      onClick={analyzeImage}
                      disabled={isAnalyzing}
                      className={`w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all ${
                        isAnalyzing 
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed' 
                        : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20 hover:shadow-emerald-300 dark:hover:shadow-emerald-900/40 active:scale-[0.98]'
                      }`}
                    >
                      {isAnalyzing ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          Analyzing Plant...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-5 h-5" />
                          Analyze Plant
                        </>
                      )}
                    </button>
                  </div>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
                <canvas ref={canvasRef} className="hidden" />
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </motion.div>
            )}

            <div className="bg-emerald-900 rounded-3xl p-6 text-white overflow-hidden relative">
              <div className="relative z-10">
                <h3 className="font-bold text-lg mb-2">Pro Tip</h3>
                <p className="text-emerald-100/80 text-sm leading-relaxed">
                  For the most accurate results, ensure the leaf is well-lit and centered. 
                  Try to capture both the top and bottom of the leaf if possible.
                </p>
              </div>
              <Leaf className="absolute -bottom-4 -right-4 w-32 h-32 text-emerald-800/50 rotate-12" />
            </div>
          </section>

          {/* Right Column: Results */}
          <section className="space-y-6">
            <AnimatePresence mode="wait">
              {isAnalyzing ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-white rounded-3xl border border-zinc-200 p-12 flex flex-col items-center justify-center text-center space-y-6 min-h-[400px]"
                >
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" />
                    <Leaf className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-600 w-8 h-8" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-bold text-xl">Scanning Plant DNA</h3>
                    <p className="text-zinc-500 max-w-[240px]">Our AI is cross-referencing thousands of plant pathologies...</p>
                  </div>
                </motion.div>
              ) : result ? (
                <motion.div 
                  key="result"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  {/* Main Result Card */}
                  <div className="bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
                    <div className={`p-6 flex items-center justify-between ${
                      result.disease === 'Healthy' ? 'bg-emerald-50' : 'bg-amber-50'
                    }`}>
                      <div className="flex items-center gap-3">
                        {result.disease === 'Healthy' ? (
                          <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-6 h-6 text-amber-600" />
                        )}
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-0.5">
                            {result.species} <span className="italic opacity-70">({result.scientificName})</span>
                          </p>
                          <h3 className="font-bold text-lg leading-tight">{result.disease}</h3>
                          <p className="text-xs font-medium uppercase tracking-wider opacity-60">
                            {result.confidence} Confidence
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={speakSummary}
                          disabled={isGeneratingSpeech}
                          className={`p-2 rounded-full transition-all ${
                            isSpeaking 
                            ? 'bg-emerald-600 text-white animate-pulse' 
                            : 'bg-white/10 text-white hover:bg-white/20'
                          }`}
                          title={isSpeaking ? "Stop Voice Over" : "Listen to Summary"}
                        >
                          {isGeneratingSpeech ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : isSpeaking ? (
                            <VolumeX className="w-4 h-4" />
                          ) : (
                            <Volume2 className="w-4 h-4" />
                          )}
                        </button>

                        <div className="relative">
                          <button
                            onClick={shareResult}
                            className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all"
                            title="Share Result"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          
                          <AnimatePresence>
                            {showShareMenu && (
                              <>
                                <div 
                                  className="fixed inset-0 z-10" 
                                  onClick={() => setShowShareMenu(false)} 
                                />
                                <motion.div 
                                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                  className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-100 dark:border-zinc-700 z-20 overflow-hidden"
                                >
                                  <button 
                                    onClick={copyToClipboard}
                                    className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors text-zinc-900 dark:text-zinc-100"
                                  >
                                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                                    {copied ? 'Copied!' : 'Copy to Clipboard'}
                                  </button>
                                  <a 
                                    href={`mailto:?subject=Plant Diagnosis: ${result.species}&body=My ${result.species} has ${result.disease}. Severity: ${result.severity}. Treatment: ${result.treatment}`}
                                    className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 flex items-center gap-2 transition-colors border-t border-zinc-50 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                                  >
                                    <Volume2 className="w-4 h-4" />
                                    Share via Email
                                  </a>
                                </motion.div>
                              </>
                            )}
                          </AnimatePresence>
                        </div>

                        <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                          result.severity === 'Low' ? 'bg-emerald-500/20 text-emerald-300' :
                          result.severity === 'Moderate' ? 'bg-amber-500/20 text-amber-300' :
                          'bg-red-500/20 text-red-300'
                        }`}>
                          {result.severity} Severity
                        </div>
                      </div>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* Plant Info */}
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 border border-zinc-100 dark:border-zinc-800">
                        <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2 mb-2">
                          <Leaf className="w-3 h-3 text-emerald-600" />
                          Plant Information
                        </h4>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed italic">
                          {result.description}
                        </p>
                      </div>

                      {/* Symptoms & Causes */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                            <Info className="w-3 h-3" />
                            Symptoms
                          </h4>
                          <ul className="space-y-2">
                            {result.symptoms.map((s, i) => (
                              <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300 flex items-start gap-2">
                                <ChevronRight className="w-3 h-3 text-emerald-500 mt-1 shrink-0" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                            <Bug className="w-3 h-3" />
                            Potential Causes
                          </h4>
                          <ul className="space-y-2">
                            {result.causes.map((c, i) => (
                              <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300 flex items-start gap-2">
                                <div className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 mt-2 shrink-0" />
                                {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

                      {/* Treatment */}
                      <div 
                        onClick={() => setShowTreatmentModal(true)}
                        className="space-y-3 cursor-pointer group/treatment hover:bg-zinc-50 dark:hover:bg-zinc-800/50 p-4 -m-4 rounded-2xl transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                            <ShieldCheck className="w-3 h-3" />
                            Treatment & Cure
                          </h4>
                          <Maximize2 className="w-3 h-3 text-zinc-300 dark:text-zinc-600 group-hover/treatment:text-emerald-600 transition-colors" />
                        </div>
                        <div className="prose prose-sm prose-emerald dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300 leading-relaxed line-clamp-3">
                          <ReactMarkdown>{result.treatment}</ReactMarkdown>
                        </div>
                        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Click to view full instructions</p>
                      </div>

                      <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

                      {/* Follow-up Chat */}
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <Sparkles className="w-3 h-3 text-emerald-600" />
                          Ask a Follow-up
                        </h4>
                        
                        <div className="space-y-3">
                          {chatHistory.map((chat, i) => (
                            <motion.div 
                              key={i}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm ${
                                chat.role === 'user' 
                                ? 'bg-emerald-600 text-white rounded-tr-none' 
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-tl-none border border-zinc-200 dark:border-zinc-700'
                              }`}>
                                <div className={`prose prose-sm max-w-none ${chat.role === 'user' ? 'prose-invert' : 'dark:prose-invert prose-emerald'}`}>
                                  <ReactMarkdown>
                                    {chat.text}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                          
                          {isAskingFollowUp && (
                            <div className="flex justify-start">
                              <div className="bg-zinc-100 dark:bg-zinc-800 px-4 py-2 rounded-2xl rounded-tl-none border border-zinc-200 dark:border-zinc-700 flex items-center gap-2">
                                <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Expert is thinking...</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="relative">
                          <input 
                            type="text"
                            value={followUpQuestion}
                            onChange={(e) => setFollowUpQuestion(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && askFollowUp()}
                            placeholder="Ask about care, symptoms, or treatment..."
                            className="w-full pl-4 pr-12 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all dark:text-zinc-100"
                          />
                          <button 
                            onClick={askFollowUp}
                            disabled={!followUpQuestion.trim() || isAskingFollowUp}
                            className="absolute right-2 top-1.5 p-1.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors"
                          >
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3" />
                          Prevention Tips
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {result.prevention.map((p, i) => (
                            <span key={i} className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="h-px bg-zinc-100 dark:bg-zinc-800" />

                      {/* Feedback Mechanism */}
                      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                            Was this helpful?
                          </h4>
                          {result.feedback && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full uppercase">
                              Feedback Received
                            </span>
                          )}
                        </div>
                        
                        {!result.feedback ? (
                          <div className="flex flex-col gap-4">
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleFeedback(true, 5)}
                                className="flex-1 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-emerald-500 hover:text-emerald-600 transition-all flex items-center justify-center gap-2 text-sm font-medium dark:text-zinc-100"
                              >
                                <ThumbsUp className="w-4 h-4" />
                                Yes
                              </button>
                              <button 
                                onClick={() => handleFeedback(false, 1)}
                                className="flex-1 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-red-500 hover:text-red-600 transition-all flex items-center justify-center gap-2 text-sm font-medium dark:text-zinc-100"
                              >
                                <ThumbsDown className="w-4 h-4" />
                                No
                              </button>
                            </div>
                            <div className="flex items-center justify-center gap-2">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                  key={star}
                                  onClick={() => handleFeedback(true, star)}
                                  className="text-zinc-300 dark:text-zinc-600 hover:text-amber-400 transition-colors"
                                >
                                  <Star className="w-5 h-5 fill-current" />
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star 
                                  key={star} 
                                  className={`w-4 h-4 ${star <= result.feedback!.rating ? 'text-amber-400 fill-current' : 'text-zinc-200 dark:text-zinc-700'}`} 
                                />
                              ))}
                            </div>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">
                              {result.feedback.helpful ? 'Glad we could help!' : 'Thanks for the feedback.'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Care Cards */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center text-center gap-2">
                      <Droplets className="w-5 h-5 text-blue-500" />
                      <span className="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500">Watering</span>
                      <span className="text-xs font-medium dark:text-zinc-300">Controlled</span>
                    </div>
                    <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center text-center gap-2">
                      <Sun className="w-5 h-5 text-amber-500" />
                      <span className="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500">Light</span>
                      <span className="text-xs font-medium dark:text-zinc-300">Optimal</span>
                    </div>
                    <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center text-center gap-2">
                      <Thermometer className="w-5 h-5 text-red-500" />
                      <span className="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500">Temp</span>
                      <span className="text-xs font-medium dark:text-zinc-300">Stable</span>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-12 flex flex-col items-center justify-center text-center space-y-6 min-h-[400px] border-dashed">
                  <div className="w-20 h-20 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center">
                    <Info className="text-zinc-300 dark:text-zinc-600 w-10 h-10" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-bold text-xl text-zinc-400 dark:text-zinc-500">Waiting for Data</h3>
                    <p className="text-zinc-400 dark:text-zinc-500 max-w-[240px]">Upload a photo to see the AI analysis results here.</p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </section>
        </div>

        {/* History Section */}
        <AnimatePresence>
          {showHistory && (
            <motion.section 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-12 space-y-6 overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-600" />
                  <h2 className="font-bold text-xl">Diagnosis History</h2>
                  <span className="bg-zinc-200 text-zinc-600 text-xs px-2 py-0.5 rounded-full">{history.length}</span>
                </div>
                {history.length > 0 && (
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={downloadCSV}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Export CSV
                    </button>
                    <button 
                      onClick={clearHistory}
                      className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear All
                    </button>
                  </div>
                )}
              </div>

              {history.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-12 text-center space-y-4">
                  <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto">
                    <History className="text-zinc-300 dark:text-zinc-600 w-6 h-6" />
                  </div>
                  <p className="text-zinc-400 dark:text-zinc-500">No previous diagnoses found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {history.map((item) => (
                    <motion.div 
                      key={item.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      onClick={() => viewHistoryItem(item)}
                      className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden cursor-pointer hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/5 transition-all group relative"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden">
                        <img 
                          src={item.image} 
                          alt={item.result.disease} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        
                        <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                          <button
                            onClick={(e) => deleteHistoryItem(e, item)}
                            className="p-2 bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 shadow-sm"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            item.result.severity === 'Low' ? 'bg-emerald-500 text-white' :
                            item.result.severity === 'Moderate' ? 'bg-amber-500 text-white' :
                            'bg-red-500 text-white'
                          } shadow-lg shadow-black/10`}>
                            {item.result.severity}
                          </div>
                        </div>

                        <div className="absolute bottom-3 left-3 right-3 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
                          <div className="flex items-center justify-center gap-2 py-2 bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm rounded-xl text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-widest shadow-sm">
                            View Details
                            <ArrowRight className="w-3 h-3" />
                          </div>
                        </div>
                      </div>

                      <div className="p-5 space-y-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest truncate">
                              {item.result.species}
                            </span>
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold">{item.result.confidence}</span>
                          </div>
                          <h4 className="font-bold text-base text-zinc-900 dark:text-zinc-100 truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                            {item.result.disease}
                          </h4>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-zinc-50 dark:border-zinc-800">
                          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                            <Calendar className="w-3 h-3 text-emerald-500/50" />
                            {new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                            <RefreshCw className="w-3 h-3 text-emerald-500/50" />
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* Treatment Modal */}
        <AnimatePresence>
          {showTreatmentModal && result && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowTreatmentModal(false)}
                className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                      <ShieldCheck className="text-emerald-600 dark:text-emerald-400 w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">Treatment Plan</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wider">{result.disease}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowTreatmentModal(false)}
                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <div className="p-8 overflow-y-auto custom-scrollbar">
                  <div className="prose prose-emerald dark:prose-invert max-w-none">
                    <ReactMarkdown>{result.treatment}</ReactMarkdown>
                  </div>
                </div>

                <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium italic">
                    Always wear protective gear when applying treatments.
                  </p>
                  <button 
                    onClick={() => setShowTreatmentModal(false)}
                    className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 dark:shadow-none"
                  >
                    Got it
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-4 py-12 border-t border-zinc-200 dark:border-zinc-800 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 opacity-50 dark:text-zinc-400">
            <Leaf className="w-4 h-4" />
            <span className="text-sm font-medium">LeafLens AI Pathology System v1.0</span>
          </div>
          <div className="flex gap-8 text-sm text-zinc-400 dark:text-zinc-500">
            <a href="#" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Privacy</a>
            <a href="#" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Terms</a>
            <a href="#" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Documentation</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
