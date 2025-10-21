'use client';

import { useChat } from '@ai-sdk/react';
import { useState, useRef, useEffect } from 'react';
import { Send, Copy, Download, RefreshCw, Settings, Database, CheckCircle, Clock, User, Bot, History, Zap, Search, Users, TrendingUp, Calendar } from 'lucide-react';

type AIInput = { query: string };
type AIOutput = { rows: string[] };

export default function Chat() {
    const [input, setInput] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [selectedDb, setSelectedDb] = useState('development');
    const [showSettings, setShowSettings] = useState(false);
    const [showQuickActions, setShowQuickActions] = useState(true);

    const suggestedQueries = [
        { icon: <Users className="w-4 h-4" />, text: "Show all active users", query: "Show me all active users in the system" },
        { icon: <TrendingUp className="w-4 h-4" />, text: "Monthly sales report", query: "Generate a monthly sales report" },
        { icon: <Calendar className="w-4 h-4" />, text: "Today's transactions", query: "Show today's transactions" },
    ];
    const { messages, sendMessage } = useChat();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, input]);

    const handleSendMessage = () => {
        if (!input.trim()) return;
        sendMessage({ text: input });
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const downloadResults = (rows: string[], queryId: string) => {
        const csv = rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query-results-${queryId}.csv`;
        a.click();
    };

    return (
        <div className="flex flex-col h-screen bg-black text-white font-sans">
            {/* Header */}
            <div className="flex items-center justify-end px-6 pt-3  bg-black/90 backdrop-blur-sm shadow-md">
                
                <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                    <Settings className="w-5 h-5 text-white/60 hover:text-white" />
                </button>
            </div>

            {/* Settings Panel */}
            <div className="relative">
                {showSettings && (
                    <div className="absolute right-3 top-1 w-72 bg-black/90 backdrop-blur-md border border-white/10 rounded-lg shadow-lg px-4 py-4 transition-all duration-300 z-50">
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-white/70 mb-2">
                                    Database Connection
                                </label>
                                <select
                                    value={selectedDb}
                                    onChange={(e) => setSelectedDb(e.target.value)}
                                    className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm hover:border-white focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition">
                                    <option value="development">Development</option>
                                    <option value="production">Production</option>
                                    <option value="staging">Staging</option>
                                </select>
                            </div>
                            <div className="text-xs text-white/60 flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                Connected to {selectedDb}
                            </div>
                        </div>
                        {/* Arrow */}
                        <div className="absolute -top-2 right-6 w-4 h-4 bg-black/90 border-l border-t border-white/10 transform rotate-45"></div>
                    </div>
                )}
            </div>

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 space-y-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {messages.length === 0 ? (
                    <>
                        <div className=" flex items-center justify-center min-h-[45vh]">
                            <div className="text-center flex flex-col justify-center items-center space-y-3">
                                <div className="border border-white/10 rounded-lg w-12 h-12 flex items-center justify-center"> 
                                <Database className="w-8 h-8 text-white mx-auto" />
                                </div>
                                <h2 className="text-5xl font-normal text-white">Your Personal <br/> AI Advisor </h2>
                                <p className="text-white/40 text-sm max-w-md">
                                    Ask questions about your database. The agent will generate and execute SQL queries for you.
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Actions Panel */}
                        <div className="mx-auto w-[800px] max-w-[90%] ">
                            <div className="bg-black/80 backdrop-blur-lg border border-white/10 rounded-2xl shadow-lg">
                                <div className="p-2">
                                    <div className="flex items-center justify-center mb-3">
                                        <h3 className="text-sm  font-medium text-white/70 flex items-center gap-2">
                                            <Zap className="w-4 h-4 text-yellow-500" />
                                            Quick Actions
                                        </h3>
                                    </div>
                                    
                                    {/* Recent Queries */}
                                    {messages.length > 0 && (
                                        <div className="mb-4">
                                            <h4 className="text-xs font-medium text-white/50 mb-2 flex items-center gap-2">
                                                <History className="w-3 h-3" /> Recent Queries
                                            </h4>
                                            <div className="space-y-2">
                                                {messages.filter(m => m.role === 'user').slice(-2).map((m, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => {
                                                            if (m.parts[0].type === 'text') {
                                                                setInput((m.parts[0] as { type: 'text'; text: string }).text);
                                                            }
                                                            scrollToBottom();
                                                        }}
                                                        className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70 transition-colors truncate">
                                                        {'text' in m.parts[0] ? (m.parts[0] as { text: string }).text : '[Unsupported message type]'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Suggested Queries */}
                                    <div>
                                        <h4 className="text-xs font-medium text-white/50 mb-2 flex items-center gap-2">
                                            <Search className="w-3 h-3" /> Suggested Queries
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                            {suggestedQueries.map((item, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => {
                                                        setInput(item.query);
                                                        scrollToBottom();
                                                    }}
                                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/70 transition-colors">
                                                    {item.icon}
                                                    {item.text}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    messages.map((message) => (
                        <div key={message.id} 
                            className={`space-y-2 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} mb-6`}
                        >
                            <div className={`flex gap-3 max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    message.role === 'user'
                                        ? 'bg-gradient-to-br from-gray-600 to-gray-700'
                                        : 'bg-gradient-to-br from-gray-700 to-gray-800'
                                }`}>
                                    {message.role === 'user' 
                                        ? <User className="w-5 h-5 text-gray-200" />
                                        : <Bot className="w-5 h-5 text-gray-200" />
                                    }
                                </div>
                                <div className={`space-y-2 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className="flex items-center gap-2 text-xs text-white/60">
                                        <span className="font-medium">
                                            {message.role === 'user' ? 'You' : 'Assistant'}
                                        </span>
                                        <span>•</span>
                                        <span>{new Date().toLocaleTimeString()}</span>
                                    </div>
                                    {message.parts.map((part, i) => {
                                        switch (part.type) {
                                            case 'text':
                                                return (
                                                    <div
                                                        key={`${message.id}-${i}`}
                                                        className={`p-4 text-white leading-relaxed rounded-2xl ${
                                                            message.role === 'user'
                                                                ? 'bg-white/5 border border-white/10'
                                                                : 'bg-white/5 border border-white/10'
                                                        }`}>
                                                        {part.text}
                                                    </div>
                                                );

                                            case 'tool-db':
                                                const query = (part.input as unknown as AIInput)?.query;
                                                const output = part.output as unknown as AIOutput;
                                                return (
                                                    <div
                                                        key={`${message.id}-${i}`}
                                                        className={`overflow-hidden rounded-2xl ${
                                                            message.role === 'user'
                                                                ? 'bg-blue-600/20 border border-blue-500/30'
                                                                : 'bg-white/5 border border-white/10'
                                                        }`}>
                                                        <div className="px-4 py-3 border-b border-white/20 flex items-center gap-2 bg-black/20">
                                                            <Database className="w-4 h-4 text-blue-400" />
                                                            <span className="font-semibold text-sm text-white/70">SQL Query</span>
                                                        </div>
                                                        <div className="p-4">
                                                            {query && (
                                                                <pre className="text-xs bg-black/50 rounded-lg p-3 overflow-x-auto text-green-400 font-mono mb-3 border border-white/10">
                                                                    {query}
                                                                </pre>
                                                            )}
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    {part.state === 'output-available' ? (
                                                                        <>
                                                                            <CheckCircle className="w-4 h-4 text-green-500" />
                                                                            <span className="text-sm text-green-400">
                                                                                ✓ Returned {output?.rows?.length || 0} rows
                                                                            </span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Clock className="w-4 h-4 text-white/50 animate-spin" />
                                                                            <span className="text-sm text-white/50">Executing...</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                                {part.state === 'output-available' && output?.rows && (
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            onClick={() => copyToClipboard(query, message.id)}
                                                                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                                                                            title="Copy query">
                                                                            <Copy className="w-4 h-4 text-white/60 hover:text-white" />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => downloadResults(output.rows, message.id)}
                                                                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                                                                            title="Download results">
                                                                            <Download className="w-4 h-4 text-white/60 hover:text-white" />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );

                                            case 'tool-schema':
                                                return (
                                                    <div
                                                        key={`${message.id}-${i}`}
                                                        className={`overflow-hidden rounded-2xl ${
                                                            message.role === 'user'
                                                                ? 'bg-blue-600/20 border border-blue-500/30'
                                                                : 'bg-white/5 border border-white/10'
                                                        }`}>
                                                        <div className="px-4 py-3 border-b border-white/20 flex items-center gap-2 bg-black/20">
                                                            <Database className="w-4 h-4 text-purple-400" />
                                                            <span className="font-semibold text-sm text-white/70">Database Schema</span>
                                                        </div>
                                                        {part.state === 'output-available' && (
                                                            <div className="px-4 py-3 flex items-center gap-2 text-green-400 text-sm">
                                                                <CheckCircle className="w-4 h-4" />
                                                                Schema loaded successfully
                                                            </div>
                                                        )}
                                                    </div>
                                                );

                                            case 'step-start':
                                                return (
                                                    <div
                                                        key={`${message.id}-${i}`}
                                                        className={`flex items-center gap-2 text-sm p-3 rounded-xl ${
                                                            message.role === 'user'
                                                                ? 'bg-blue-600/10 text-blue-400'
                                                                : 'bg-purple-500/10 text-purple-400'
                                                        }`}>
                                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                                        Processing your request...
                                                    </div>
                                                );

                                            default:
                                                return null;
                                        }
                                        })}
                                </div>
                            </div>
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>            {/* Floating Input Area */}
            <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 w-[800px] max-w-[90%]">
                <div className="  px-6 py-4">
                    <div className="space-y-2">
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask your database question..."
                                className="flex-1 bg-white/5 border border-white/20 rounded-full px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all"
                            />
                            <button
                                onClick={handleSendMessage}
                                disabled={!input.trim()}
                                className="bg-gray-300 hover:bg-white/20 disabled:bg-gray-700 disabled:text-black text-black rounded-full px-4 py-3 font-medium flex items-center gap-2 transition-colors">
                                <span className="hidden sm:inline">Send</span>
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-xs text-white/50 text-center">
                            Connected to: <span className="text-white/70 font-medium">{selectedDb}</span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
