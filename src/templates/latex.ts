export const DEFAULT_LATEX_TEMPLATE = `\\documentclass[a4paper,10pt]{article}
\\usepackage[margin=1cm]{geometry}
\\usepackage{parskip}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{multicol}
\\usepackage{graphicx}
\\usepackage{setspace}
\\usepackage{tabularx}
\\usepackage{fontawesome5}

% Define color for links
\\definecolor{mainblue}{RGB}{31, 78, 121}
\\hypersetup{
    colorlinks=true,
    linkcolor=mainblue,
    urlcolor=mainblue,
    citecolor=mainblue
}

% Section formatting
\\titleformat{\\section}{\\color{mainblue}\\bfseries\\uppercase}{\\thesection}{1em}{}
\\titleformat{\\subsection}[runin]{\\bfseries}{}{0pt}{}[ — ]
\\renewcommand{\\labelitemi}{\\textbullet}
\\setlist[itemize]{noitemsep, topsep=0pt, left=0.5em}
\\pagestyle{empty}

\\begin{document}

\\begin{center}
    {\\LARGE \\textbf{JAI SHANKAR}}\\\\[4pt]
    \\textit{Software Engineer} \\\\
    Bengaluru, India \\\\
    \\href{mailto:jaimauryatech@gmail.com}{jaimauryatech@gmail.com} \\quad | \\quad
    \\href{tel:+917644053913}{+91 76440 53913} \\quad | \\quad
    \\href{https://www.linkedin.com/in/jai-shankar-b7b388234}{LinkedIn} \\quad |\\quad
    \\href{https://profile.theweekendworld.com/}{Portfolio} \\quad | \\quad
    \\href{https://github.com/jai0651}{GitHub} \\quad | \\quad
     \\href{https://codeforces.com/profile/ryukk19}{CodeForces}
\\end{center}



\\vspace{0.5em}
\\section*{ABOUT ME}
Backend-focused Software Engineer with a passion for building scalable, high-performance systems and automating complex workflows. Experienced in microservices, event-driven architectures, and cloud-native development. Committed to writing clean, maintainable code and solving challenging problems. Active learner with a \\textbf{1470(max) Codeforces rating} and a keen interest in emerging technologies..

\\section*{EDUCATION}
\\textbf{B.Tech in Engineering and Computational Mechanics} \\\\
\\textit{Indian Institute of Technology Delhi (IIT Delhi)} \\hfill \\textit{2020 – 2024}

\\section*{WORK EXPERIENCE}

\\textbf{Software Engineer I (Platform)} \\hfill \\textit{Plivo Inc., Bengaluru} \\\\
\\textit{Sept 2025 – Present}
\\begin{itemize}
  \\item Engineered a robust \\textbf{data ingestion pipeline} using \\textbf{Apache Airflow}, improving workflow reliability and reducing operational failures across business-critical processes.
  \\item Developed \\textbf{low-latency, high-throughput Go APIs} powering customer onboarding, account management, and invoicing; optimized critical paths to reduce response times under peak load.
  \\item Integrated third-party services including \\textbf{MaxMind, WhatsApp Business APIs, and LLM-based processing}, enabling automated validation, enriched customer workflows, and intelligent data extraction.
  \\item Built \\textbf{Redshift-based analytics pipelines} supporting reporting, financial insights, and compliance, improving data availability and reducing BI latency.
\\end{itemize}

\\textbf{Software Engineer I} \\hfill \\textit{Hyperbots Inc., Bengaluru} \\\\
\\textit{June 2024 – Aug 2025}
\\begin{itemize}
  \\item Developed \\textbf{5 microservices} for scalable, template‑driven notifications and job scheduling, processing \\textbf{1M+ messages/day}.
  \\item Implemented \\textbf{CQRS} (Elasticsearch for reads, MongoDB/PostgreSQL for writes) to boost query throughput by \\textbf{60\\%} and enable advanced filtering/search.
  \\item Integrated \\textbf{Debezium CDC} for real‑time data sync, eliminating custom sync code and reducing API latency by \\textbf{40\\%}.
  \\item Optimized database performance with strategic \\textbf{indexing}, improving query times by \\textbf{40\\%} and ensuring scalability.
  \\item Built \\textbf{React.js dashboards} for self‑service analytics, saving \\textbf{20 dev‑hrs/week} and enhancing operational visibility.
 \\item Leveraged existing \\textbf{event streams} to implement platform metrics, pipeline monitoring, and alerting—enhancing observability without changing the core architecture.
\\end{itemize}

\\textbf{Software Development Intern} \\hfill \\textit{2Sigma School, Remote (USA)} \\\\
\\textit{Mar 2024 – May 2024}
\\begin{itemize}
  \\item Integrated \\textbf{Pyodide (WebAssembly‑based Python runtime)} to enable secure, in‑browser Python execution—eliminating reliance on remote code execution services.
  \\item Deployed a \\textbf{Dockerized, language‑agnostic execution engine} using \\textbf{Piston} to support multi‑language code execution in a sandboxed environment.
  \\item Hosted remote execution services on \\textbf{GCP Cloud Run}, leveraging autoscaling and stateless containers to \\textbf{reduce infrastructure costs by 70\\%}.
\\end{itemize}

\\textbf{Software Development Intern} \\hfill \\textit{Swachh.io, New Delhi} \\\\
\\textit{May 2023 – Jul 2023}
\\begin{itemize}
  \\item Developed a cross-platform \\textbf{affiliate marketing app} in \\textbf{Flutter}, integrated with Shopify to boost sales through user referrals and rewards.
  \\item Implemented \\textbf{payment and discount modules} with robust error handling, integrating Shopify and Google Sheets APIs for seamless data sync.
  \\item Deployed backend services on \\textbf{AWS} and \\textbf{Firebase}, and configured \\textbf{CI/CD pipelines} using GitHub Actions for automated deployments.
  \\item Provisioned and maintained \\textbf{Mattermost servers} for internal communication and team collaboration.
\\end{itemize}

\\section*{SKILLS}
\\begin{multicols}{2}
\\raggedright
\\begin{itemize}[leftmargin=1.2em, itemsep=4pt]  % itemsep adds space between items
    \\item \\textbf{Backend \\& Cloud:} Golang, Spring Boot, Node.js, Kafka, AWS, GCP, Docker,FastAPI , Django
    \\item \\textbf{Blockchain:} Solana , Ethereum 
    \\item \\textbf{Frontend \\& Mobile:} React.js, Next.js, Electron.js, React Native
    \\item \\textbf{Databases:} PostgreSQL, MongoDB, ElasticSearch, GraphDB, Redis , RedShift
    \\item \\textbf{DevOps:} Kubernetes, Jenkins, Bash, CDN, Lambda, S3
    \\item \\textbf{Languages:} Java, JavaScript, C++, Rust , Go, Python, HTML, CSS, TypeScript
\\end{itemize}
\\end{multicols}


\\section*{PROJECTS}
\\noindent
\\textbf{Dpin-Uptime – Web3 SaaS Platform}
\\hfill
\\href{https://github.com/jai0651/dpin-uptime}{\\textcolor{mainblue}{[Repo]}} \\\\
\\vspace{-0.5em}
\\begin{itemize}[leftmargin=1.5em, itemsep=0.25em, topsep=0pt]
  \\item Built a decentralized uptime monitoring system rewarding global validators in \\textbf{Solana tokens} for verifying site availability.
  \\item Tech stack: \\textbf{Next.js}, \\textbf{Node.js}, \\textbf{WebSocket}, \\textbf{Web3.js} (Solana blockchain).
  \\item Implemented \\textbf{distributed transactions} to sync Solana smart contracts with \\textbf{PostgreSQL} records.
  \\item Designed scalable backend architecture for real-time uptime checks and validator coordination.
\\end{itemize}

\\vspace{0.5em}
\\noindent
\\textbf{AI Search Engine}
\\hfill
\\href{https://github.com/jai0651/open-exa}{\\textcolor{mainblue}{[Repo]}}
\\vspace{-0.4em}
\\begin{itemize}[leftmargin=1.5em, itemsep=0.25em]
  \\item Engineered a distributed \\textbf{hybrid search engine} in Go combining \\textbf{BM25 keyword search (Elasticsearch)} with \\textbf{semantic vector retrieval (ChromaDB)}.
  \\item Built a polite, rate-limited \\textbf{web crawler} with HTML parsing and intelligent chunking to maximize indexing quality.
  \\item Implemented an \\textbf{LLM-based reranking pipeline} (OpenRouter) to significantly improve search relevance and retrieval accuracy.
  \\item Designed a modular, containerized architecture orchestrating \\textbf{Go services, PostgreSQL, Redis, Chroma, and Elasticsearch} via Docker Compose.
  \\item Tech Stack: \\textbf{Go, Elasticsearch, ChromaDB, PostgreSQL, Redis, Docker, Docker Compose, OpenRouter}
\\end{itemize}

\\vspace{0.5em}
\\noindent
\\textbf{TripGennie.in}
\\hfill
\\href{https://tripgennie.in}{\\textcolor{mainblue}{[Live]}} \\,
\\href{https://github.com/theweekendworld-engg/trip-gennie}{\\textcolor{mainblue}{[Repo]}}
\\vspace{-0.4em}
\\begin{itemize}[leftmargin=1.5em, itemsep=0.25em]
  \\item Built a high-performance travel discovery platform with a \\textbf{cache-first ingestion architecture}, reducing Google Maps API costs by \\textbf{99\\%}.
  \\item Engineered a scalable \\textbf{Prisma + PostgreSQL schema} modeling 150+ destinations across 6 cities, optimized for sub-second geospatial queries.
  \\item Developed a secure \\textbf{admin dashboard} with NextAuth.js, real-time content controls, and analytics.
  \\item Implemented advanced \\textbf{SEO strategies} including dynamic metadata, OpenGraph tags, and JSON-LD for rich Google results.
  \\item Tech Stack:\\textbf{ Next.js, TypeScript, Prisma, PostgreSQL, Tailwind, NextAuth.js, Google Maps API}
\\end{itemize}

\\vspace{0.5em}
\\noindent
\\textbf{KlipKosh.com}
\\hfill
\\href{https://klipkosh.com}{\\textcolor{mainblue}{[Live]}} \\,
\\href{https://github.com/theweekendworld-engg/klipkosh-UI}{\\textcolor{mainblue}{[Repo]}}
\\vspace{-0.4em}
\\begin{itemize}[leftmargin=1.5em, itemsep=0.25em]
  \\item Architected a scalable \\textbf{FastAPI backend} for converting YouTube videos into structured articles and social media posts.
  \\item Implemented an \\textbf{async event-driven architecture} using Celery and Redis for heavy transcript extraction + AI generation workflows.
  \\item Integrated OpenAI and OpenRouter with a custom \\textbf{token usage + cost optimization layer} to minimize LLM spend.
  \\item Designed a robust \\textbf{PostgreSQL + SQLAlchemy schema} to manage multi-step generation pipelines.
  \\item Tech Stack: \\textbf{FastAPI, Python, Celery, Redis, PostgreSQL, SQLAlchemy, OpenAI API, OpenRouter, Docker}
\\end{itemize}

\\section*{INTERESTS}
Competitive Programming (\\href{https://codeforces.com/profile/ryukk19}{\\textcolor{mainblue}{Codeforces}}, LeetCode, CodeChef) \\\\
Scalable System Design, Cloud Infrastructure, Chess \\& Strategy Games

\\end{document}
`;
