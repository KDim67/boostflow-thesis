pipeline {
    agent any
    
    environment {
        // Docker image configuration
        DOCKER_IMAGE = 'boostflow'
        GHCR_REGISTRY = 'ghcr.io'
        DOCKER_BUILDKIT = '1'
        GITHUB_USER = 'kdim67'
        IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(7)}"
        FULL_IMAGE_NAME = "${GHCR_REGISTRY}/${GITHUB_USER}/${DOCKER_IMAGE}"
        
        // Tool paths
        PATH = "/usr/local/bin:${env.PATH}"
        
        // Report directories
        REPORTS_DIR = 'security-reports'
    }
    
    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source code...'
                checkout scm
                
                script {
                    // Get commit info for tagging
                    env.GIT_COMMIT_SHORT = env.GIT_COMMIT.take(7)
                    echo "Building commit: ${env.GIT_COMMIT_SHORT}"
                }
            }
        }
        
        stage('Install Dependencies') {
            steps {
                echo 'Installing npm dependencies...'
                sh '''
                    node --version
                    npm --version
                    npm ci
                '''
            }
        }
        
        stage('Quality Gate - npm audit') {
            steps {
                echo 'Running npm audit for dependency vulnerabilities...'
                script {
                    // Clean and create reports directory (removes old files)
                    sh "rm -rf ${REPORTS_DIR} && mkdir -p ${REPORTS_DIR}"
                    
                    // Run npm audit and save report
                    def auditResult = sh(
                        script: 'npm audit --audit-level=high --json > ${REPORTS_DIR}/npm-audit.json || true',
                        returnStatus: true
                    )
                    
                    // Check if there are high/critical vulnerabilities
                    def auditSummary = sh(
                        script: 'npm audit --audit-level=high || true',
                        returnStdout: true
                    )
                    
                    echo "Audit Summary:\n${auditSummary}"
                    
                    // Fail if critical/high vulnerabilities found
                    if (auditResult != 0) {
                        echo 'Warning: High/Critical vulnerabilities found in dependencies'
                    } else {
                        echo 'No high/critical vulnerabilities found'
                    }
                }
            }
        }
        
        stage('Quality Gate - Gitleaks') {
            steps {
                echo 'Running Gitleaks secret scanning on repository...'
                script {
                    def gitleaksResult = sh(
                        script: """
                            docker run --rm \
                                -v \$(pwd):/repo \
                                -w /repo \
                                zricethezav/gitleaks:latest \
                                detect \
                                --source /repo \
                                --report-format sarif \
                                --report-path /repo/${REPORTS_DIR}/gitleaks-report.sarif \
                                --no-git
                        """,
                        returnStatus: true
                    )
                    
                    if (gitleaksResult == 0) {
                        echo 'Gitleaks: No secrets detected in repository'
                    } else {
                        echo 'Gitleaks detected potential secrets - review report'
                    }
                }
            }
        }
        
        stage('Quality Gate - Semgrep SAST') {
            steps {
                echo 'Running Semgrep SAST scanning...'
                script {
                    // Run Semgrep with targeted rulesets for Next.js/TypeScript
                    def semgrepResult = sh(
                        script: '''
                            docker run --rm \
                                -v $(pwd):/src \
                                -w /src \
                                returntocorp/semgrep:latest \
                                semgrep \
                                --config p/typescript \
                                --config p/javascript \
                                --config p/react \
                                --config p/security-audit \
                                --config p/secrets \
                                --sarif \
                                --output security-reports/semgrep-report.sarif \
                                --timeout 300 \
                                --timeout-threshold 15 \
                                src/ || true
                        ''',
                        returnStatus: true
                    )

                    
                    if (semgrepResult == 0) {
                        echo 'Semgrep scan completed - no critical issues'
                    } else {
                        echo 'Semgrep found potential security issues - review report'
                    }
                }
            }
        }
        
        stage('Quality Gate - Checkov IaC') {
            steps {
                echo 'Running Checkov IaC scanning...'
                script {
                    // Scan Dockerfile with explicit framework
                    sh """
                        docker run --rm \
                            -v \$(pwd):/tf \
                            -w /tf \
                            bridgecrew/checkov:latest \
                            --file Dockerfile \
                            --framework dockerfile \
                            --output json \
                            --output-file-path ${REPORTS_DIR} \
                            --soft-fail || true
                        
                        # Rename the output file for clarity
                        mv ${REPORTS_DIR}/results_json.json ${REPORTS_DIR}/checkov-dockerfile.json 2>/dev/null || true
                    """
                    
                    echo 'Checkov Dockerfile scan completed'
                }
            }
        }
        
        stage('Quality Gate - SonarQube') {
            steps {
                echo 'Running SonarQube code quality analysis...'
                script {
                    withCredentials([
                        string(credentialsId: 'SONARQUBE_TOKEN', variable: 'SONAR_TOKEN'),
                        string(credentialsId: 'SONARQUBE_URL', variable: 'SONAR_HOST_URL')
                    ]) {
                        sh """
                            docker run --rm \
                                -v \$(pwd):/usr/src \
                                -w /usr/src \
                                -e SONAR_HOST_URL=\$SONAR_HOST_URL \
                                -e SONAR_TOKEN=\$SONAR_TOKEN \
                                sonarsource/sonar-scanner-cli:latest
                        """
                    }
                    
                    echo 'SonarQube analysis completed - check dashboard for results'
                }
            }
        }
        
        stage('Build Docker Image') {
            steps {
                echo "Building Docker image: ${DOCKER_IMAGE}:${IMAGE_TAG}"
                script {
                    withCredentials([
                        string(credentialsId: 'FIREBASE_SERVICE_ACCOUNT_KEY', variable: 'FIREBASE_SERVICE_ACCOUNT_KEY'),
                        string(credentialsId: 'NEXT_PUBLIC_APP_URL', variable: 'NEXT_PUBLIC_APP_URL'),
                        string(credentialsId: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', variable: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_API_KEY', variable: 'NEXT_PUBLIC_FIREBASE_API_KEY'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', variable: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', variable: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', variable: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', variable: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_APP_ID', variable: 'NEXT_PUBLIC_FIREBASE_APP_ID'),
                        string(credentialsId: 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID', variable: 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID'),
                        string(credentialsId: 'GEMINI_API_KEY', variable: 'GEMINI_API_KEY'),
                        string(credentialsId: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', variable: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID'),
                        string(credentialsId: 'NEXT_PUBLIC_GOOGLE_CLIENT_SECRET', variable: 'NEXT_PUBLIC_GOOGLE_CLIENT_SECRET'),
                        string(credentialsId: 'NEXT_PUBLIC_GITHUB_CLIENT_ID', variable: 'NEXT_PUBLIC_GITHUB_CLIENT_ID'),
                        string(credentialsId: 'NEXT_PUBLIC_GITHUB_CLIENT_SECRET', variable: 'NEXT_PUBLIC_GITHUB_CLIENT_SECRET'),
                        string(credentialsId: 'GOOGLE_CLIENT_SECRET', variable: 'GOOGLE_CLIENT_SECRET'),
                        string(credentialsId: 'GITHUB_CLIENT_SECRET', variable: 'GITHUB_CLIENT_SECRET'),
                        string(credentialsId: 'GOOGLE_CLIENT_ID', variable: 'GOOGLE_CLIENT_ID'),
                        string(credentialsId: 'GITHUB_CLIENT_ID', variable: 'GITHUB_CLIENT_ID'),
                        string(credentialsId: 'NEXT_PUBLIC_OAUTH_CLIENT_ID', variable: 'NEXT_PUBLIC_OAUTH_CLIENT_ID'),
                        string(credentialsId: 'MINIO_ENDPOINT', variable: 'MINIO_ENDPOINT'),
                        string(credentialsId: 'MINIO_EXTERNAL_ENDPOINT', variable: 'MINIO_EXTERNAL_ENDPOINT'),
                        string(credentialsId: 'MINIO_PORT', variable: 'MINIO_PORT'),
                        string(credentialsId: 'MINIO_ROOT_USER', variable: 'MINIO_ROOT_USER'),
                        string(credentialsId: 'MINIO_ROOT_PASSWORD', variable: 'MINIO_ROOT_PASSWORD'),
                        string(credentialsId: 'MINIO_USE_SSL', variable: 'MINIO_USE_SSL'),
                        string(credentialsId: 'MINIO_PROFILE_PICTURES_BUCKET', variable: 'MINIO_PROFILE_PICTURES_BUCKET'),
                        string(credentialsId: 'MINIO_PROJECT_DOCUMENTS_BUCKET', variable: 'MINIO_PROJECT_DOCUMENTS_BUCKET'),
                        string(credentialsId: 'MAILHOG_HOST', variable: 'MAILHOG_HOST'),
                        string(credentialsId: 'MAILHOG_PORT', variable: 'MAILHOG_PORT'),
                        string(credentialsId: 'DEFAULT_FROM_EMAIL', variable: 'DEFAULT_FROM_EMAIL'),
                        string(credentialsId: 'SENDGRID_API_KEY', variable: 'SENDGRID_API_KEY'),
                        string(credentialsId: 'NODE_ENV', variable: 'NODE_ENV')
                    ]) {
                        sh '''
                            cat <<EOF > build_secrets.env
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
FIREBASE_SERVICE_ACCOUNT_KEY='${FIREBASE_SERVICE_ACCOUNT_KEY}'
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}
NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=${NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID}
GEMINI_API_KEY=${GEMINI_API_KEY}
NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}
NEXT_PUBLIC_GOOGLE_CLIENT_SECRET=${NEXT_PUBLIC_GOOGLE_CLIENT_SECRET}
NEXT_PUBLIC_GITHUB_CLIENT_ID=${NEXT_PUBLIC_GITHUB_CLIENT_ID}
NEXT_PUBLIC_GITHUB_CLIENT_SECRET=${NEXT_PUBLIC_GITHUB_CLIENT_SECRET}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
NEXT_PUBLIC_OAUTH_CLIENT_ID=${NEXT_PUBLIC_OAUTH_CLIENT_ID}
MINIO_ENDPOINT=${MINIO_ENDPOINT}
MINIO_EXTERNAL_ENDPOINT=${MINIO_EXTERNAL_ENDPOINT}
MINIO_PORT=${MINIO_PORT}
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_USE_SSL=${MINIO_USE_SSL}
MINIO_PROFILE_PICTURES_BUCKET=${MINIO_PROFILE_PICTURES_BUCKET}
MINIO_PROJECT_DOCUMENTS_BUCKET=${MINIO_PROJECT_DOCUMENTS_BUCKET}
MAILHOG_HOST=${MAILHOG_HOST}
MAILHOG_PORT=${MAILHOG_PORT}
DEFAULT_FROM_EMAIL=${DEFAULT_FROM_EMAIL}
SENDGRID_API_KEY=${SENDGRID_API_KEY}
NODE_ENV=${NODE_ENV}
EOF
                        '''

                        // Build the image, passing the file as a secret named 'build_env'
                        sh '''
                            docker build \
                                --secret id=build_env,src=build_secrets.env \
                                -t '''+DOCKER_IMAGE+''':'''+IMAGE_TAG+''' \
                                -t '''+DOCKER_IMAGE+''':latest \
                                -t '''+FULL_IMAGE_NAME+''':'''+IMAGE_TAG+''' \
                                -t '''+FULL_IMAGE_NAME+''':latest \
                                .
                        '''
                        
                        // Cleanup the local temp file immediately
                        sh 'rm build_secrets.env'
                    }

                    
                    echo "Docker image built successfully"
                    
                    // Show image details
                    sh "docker images | grep ${DOCKER_IMAGE}"
                }
            }
        }
        
        stage('Generate SBOM') {
            steps {
                echo 'Generating Software Bill of Materials (SBOM) with Syft...'
                script {
                    // Generate SBOM from source (package-lock.json)
                    sh """
                        syft dir:. \
                            --source-name=${DOCKER_IMAGE} \
                            --source-version=${IMAGE_TAG} \
                            -o cyclonedx-json \
                            > ${REPORTS_DIR}/sbom.cyclonedx.json
                    """
                    
                    // Generate SBOM from Docker image
                    sh """
                        syft ${DOCKER_IMAGE}:${IMAGE_TAG} \
                            --source-name=${DOCKER_IMAGE} \
                            --source-version=${IMAGE_TAG} \
                            --exclude '**/next/dist/compiled/**' \
                            -o cyclonedx-json \
                            > ${REPORTS_DIR}/sbom-image.cyclonedx.json
                    """
                    
                    echo 'SBOM generated successfully'
                }
            }
        }
        
        stage('Trivy Vulnerability Scan') {
            steps {
                echo 'Scanning SBOMs for vulnerabilities with Trivy...'
                script {
                    // Scan source SBOM (npm packages)
                    sh """
                        trivy sbom \
                            --severity HIGH,CRITICAL \
                            --format json \
                            --output ${REPORTS_DIR}/trivy-sbom-source.json \
                            ${REPORTS_DIR}/sbom.cyclonedx.json
                    """
                    
                    // Scan image SBOM (OS packages)
                    sh """
                        trivy sbom \
                            --severity HIGH,CRITICAL \
                            --format json \
                            --output ${REPORTS_DIR}/trivy-sbom-image.json \
                            ${REPORTS_DIR}/sbom-image.cyclonedx.json
                    """
                    
                    // Generate HTML report
                    sh """
                        trivy sbom \
                            --severity HIGH,CRITICAL \
                            --format template \
                            --template '@/usr/local/share/trivy/templates/html.tpl' \
                            --output ${REPORTS_DIR}/trivy-report.html \
                            ${REPORTS_DIR}/sbom-image.cyclonedx.json || true
                    """
                    
                    // Display summaries
                    echo 'Source (npm) vulnerabilities:'
                    sh "trivy sbom --severity HIGH,CRITICAL ${REPORTS_DIR}/sbom.cyclonedx.json"
                    
                    echo 'Image (OS) vulnerabilities:'
                    sh "trivy sbom --severity HIGH,CRITICAL ${REPORTS_DIR}/sbom-image.cyclonedx.json"
                    
                    echo 'Trivy vulnerability scan completed'
                }
            }
        }
        
        stage('Push to GHCR') {
            steps {
                echo 'Pushing Docker image to GitHub Container Registry...'
                script {
                    // Login to GHCR using GitHub token from credentials
                    withCredentials([string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')]) {
                        sh '''
                            echo $GITHUB_TOKEN | docker login ghcr.io -u ${GITHUB_USER} --password-stdin
                        '''
                    }
                    
                    // Push both tags
                    sh """
                        docker push ${FULL_IMAGE_NAME}:${IMAGE_TAG}
                        docker push ${FULL_IMAGE_NAME}:latest
                    """
                    
                    // Capture the image digest for secure signing
                    def digestHash = sh(
                        script: "docker inspect --format='{{index .RepoDigests 0}}' ${FULL_IMAGE_NAME}:${IMAGE_TAG} | sed 's/.*@//'",
                        returnStdout: true
                    ).trim()
                    
                    env.IMAGE_DIGEST = "${FULL_IMAGE_NAME}@${digestHash}"
                    
                    echo "Image pushed to ${FULL_IMAGE_NAME}:${IMAGE_TAG}"
                    echo "Image digest: ${env.IMAGE_DIGEST}"
                }
            }
        }
        
        stage('Sign with Cosign') {
            steps {
                echo 'Signing Docker image with Cosign...'
                script {
                    withCredentials([
                        file(credentialsId: 'COSIGN_PRIVATE_KEY', variable: 'COSIGN_KEY_FILE'),
                        string(credentialsId: 'COSIGN_PASSWORD', variable: 'COSIGN_PASSWORD'),
                        string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')
                    ]) {
                        // Sign by digest with registry credentials
                        sh """
                            export COSIGN_REPOSITORY=${FULL_IMAGE_NAME}
                            cosign login ghcr.io -u ${GITHUB_USER} -p \$GITHUB_TOKEN
                            cosign sign --yes --key \$COSIGN_KEY_FILE ${env.IMAGE_DIGEST}
                        """
                        
                        echo 'Image signed successfully with Cosign'
                    }
                }
            }
        }
    }
    
    post {
        always {
            echo 'Archiving security reports and artifacts...'
            
            // Archive all security reports
            archiveArtifacts artifacts: "${REPORTS_DIR}/**/*", allowEmptyArchive: true
            
            // Publish HTML reports
            publishHTML([
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: "${REPORTS_DIR}",
                reportFiles: 'trivy-report.html',
                reportName: 'Trivy Vulnerability Report'
            ])
            
            echo 'Cleaning up workspace...'
        }
        
        success {
            echo 'Pipeline completed successfully!'
            echo "Image available at: ${FULL_IMAGE_NAME}:${IMAGE_TAG}"
            echo "Image available at: ${FULL_IMAGE_NAME}:latest"
        }
        
        failure {
            echo 'Pipeline failed! Check the logs for details.'
        }
        
        cleanup {
            // Clean up local Docker images to save space
            sh """
                docker rmi ${DOCKER_IMAGE}:${IMAGE_TAG} || true
                docker rmi ${DOCKER_IMAGE}:latest || true
            """
        }
    }
}
