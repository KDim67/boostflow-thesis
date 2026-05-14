pipeline {
    agent any
    
    options {
        skipDefaultCheckout()
        timeout(time: 1, unit: 'HOURS')
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        // Docker image configuration
        DOCKER_IMAGE = 'boostflow'
        GHCR_REGISTRY = 'ghcr.io'
        DOCKER_BUILDKIT = '1'
        GITHUB_USER = 'kdim67'
        FULL_IMAGE_NAME = "${GHCR_REGISTRY}/${GITHUB_USER}/${DOCKER_IMAGE}"

        // Pinned scanner image versions
        GITLEAKS_IMAGE   = 'zricethezav/gitleaks:v8.21.2'
        SEMGREP_IMAGE    = 'returntocorp/semgrep:1.95.0'
        CHECKOV_IMAGE    = 'bridgecrew/checkov:3.2.256'
        CONFTEST_IMAGE   = 'openpolicyagent/conftest:v0.56.0'
        SONAR_IMAGE      = 'sonarsource/sonar-scanner-cli:11.1'

        // Tool paths
        PATH = "/usr/local/bin:${env.PATH}"
        
        // Report directories
        REPORTS_DIR = 'security-reports'
        
        STAGING_URL = credentials('STAGING_URL')
    }
    
    stages {
        stage('Checkout') {
            steps {
                echo 'Cleaning workspace from previous builds...'
                cleanWs()
                echo 'Checking out source code...'
                script {
                    def scmVars = checkout scm
                    env.GIT_COMMIT_SHORT = scmVars.GIT_COMMIT.take(7)
                    env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT_SHORT}"
                    echo "Building commit: ${env.GIT_COMMIT_SHORT}"
                }
            }
        }
        
        stage('Install Dependencies') {
            options { timeout(time: 10, unit: 'MINUTES') }
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

                    // Save full JSON report
                    sh 'npm audit --json > ${REPORTS_DIR}/npm-audit.json || true'

                    // Fail on CRITICAL
                    def criticalResult = sh(
                        script: 'npm audit --audit-level=critical',
                        returnStatus: true
                    )
                    if (criticalResult != 0) {
                        error 'CRITICAL vulnerabilities detected in dependencies - build blocked'
                    }

                    // Unstable on HIGH
                    def highResult = sh(
                        script: 'npm audit --audit-level=high',
                        returnStatus: true
                    )
                    if (highResult != 0) {
                        unstable 'HIGH vulnerabilities detected in dependencies (review npm-audit.json)'
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
                                --memory=1g --memory-swap=1g \
                                -v \$(pwd):/repo:ro \
                                -v \$(pwd)/${REPORTS_DIR}:/reports \
                                -w /repo \
                                ${GITLEAKS_IMAGE} \
                                detect \
                                --source /repo \
                                --report-format sarif \
                                --report-path /reports/gitleaks-report.sarif \
                                --redact
                        """,
                        returnStatus: true
                    )
                    
                    if (gitleaksResult == 0) {
                        echo 'Gitleaks: No secrets detected in repository'
                    } else {
                        error 'Gitleaks detected secrets in repository - build blocked (see gitleaks-report.sarif)'
                    }
                }
            }
        }
        
        stage('Quality Gate - Semgrep SAST') {
            options { timeout(time: 15, unit: 'MINUTES') }
            steps {
                echo 'Running Semgrep SAST scanning...'
                script {
                    // Run Semgrep with targeted rulesets for Next.js/TypeScript
                    def semgrepResult = sh(
                        script: """
                            docker run --rm \
                                --memory=1g --memory-swap=1g \
                                -v \$(pwd):/src:ro \
                                -v \$(pwd)/${REPORTS_DIR}:/reports \
                                -w /src \
                                ${SEMGREP_IMAGE} \
                                semgrep \
                                --config p/typescript \
                                --config p/javascript \
                                --config p/react \
                                --config p/security-audit \
                                --config p/secrets \
                                --exclude node_modules \
                                --exclude .next \
                                --exclude coverage \
                                --exclude public \
                                --exclude '*.test.ts' \
                                --exclude '*.test.tsx' \
                                --sarif \
                                --output /reports/semgrep-report.sarif \
                                --timeout 300 \
                                --timeout-threshold 15 \
                                --jobs 1 \
                                src/
                        """,
                        returnStatus: true
                    )

                    if (semgrepResult != 0) {
                        error 'Semgrep found potential security issues - check report'
                    }
                    echo 'Semgrep scan completed - no critical issues'
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
                            --memory=1g --memory-swap=1g \
                            -v \$(pwd)/Dockerfile:/tf/Dockerfile:ro \
                            -v \$(pwd)/${REPORTS_DIR}:/tf/${REPORTS_DIR} \
                            -w /tf \
                            ${CHECKOV_IMAGE} \
                            --file Dockerfile \
                            --framework dockerfile \
                            --output json \
                            --output-file-path ${REPORTS_DIR} \
                            --soft-fail

                        mv ${REPORTS_DIR}/results_json.json ${REPORTS_DIR}/checkov-dockerfile.json 2>/dev/null || true
                    """

                    def failedCount = sh(
                        script: "jq '.summary.failed // 0' ${REPORTS_DIR}/checkov-dockerfile.json 2>/dev/null || echo 0",
                        returnStdout: true
                    ).trim()
                    if (failedCount.isInteger() && failedCount.toInteger() > 0) {
                        error "Checkov detected ${failedCount} Dockerfile policy violations - build blocked (see checkov-dockerfile.json)"
                    } else {
                        echo 'Checkov Dockerfile scan completed - no violations'
                    }
                }
            }
        }
        
        stage('Quality Gate - OPA/Conftest') {
            steps {
                echo 'Running OPA/Conftest policy checks...'
                script {
                    def conftestDocker = sh(
                        script: """
                            docker run --rm \\
                                --memory=512m --memory-swap=512m \\
                                -v \$(pwd):/project:ro \\
                                -w /project \\
                                ${CONFTEST_IMAGE} \\
                                test Dockerfile --policy policies/ \\
                                --parser dockerfile \\
                                --output json > ${REPORTS_DIR}/conftest-dockerfile.json
                        """,
                        returnStatus: true
                    )
                    
                    if (conftestDocker == 0) {
                        echo 'Conftest Dockerfile policy check passed'
                    } else {
                        unstable 'Conftest Dockerfile policy violations detected (see conftest-dockerfile.json)'
                    }

                    withCredentials([string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')]) {
                        sh """
                            rm -rf boostflow-thesis-config
                            git clone https://${GITHUB_USER}:\${GITHUB_TOKEN}@github.com/${GITHUB_USER}/boostflow-thesis-config.git boostflow-thesis-config
                        """
                    }

                    def conftestK8s = sh(
                        script: """
                            docker run --rm \\
                                --memory=512m --memory-swap=512m \\
                                -v \$(pwd):/project:ro \\
                                -w /project \\
                                ${CONFTEST_IMAGE} \\
                                test boostflow-thesis-config/app-deployment.yaml boostflow-thesis-config/minio-statefulset.yaml \\
                                --policy policies/ \\
                                --output json > ${REPORTS_DIR}/conftest-k8s.json
                        """,
                        returnStatus: true
                    )
                    
                    if (conftestK8s == 0) {
                        echo 'Conftest Kubernetes policy check passed'
                    } else {
                        unstable 'Conftest Kubernetes policy violations detected (see conftest-k8s.json)'
                    }

                    sh 'rm -rf boostflow-thesis-config'
                }
            }
        }
        
        stage('Quality Gate - Tests') {
            steps {
                echo 'Running unit tests with coverage...'
                sh 'npm run test:coverage -- --ci --runInBand'
            }
        }
        
        stage('Quality Gate - SonarQube') {
            options { timeout(time: 15, unit: 'MINUTES') }
            steps {
                echo 'Running SonarQube code quality analysis...'
                script {
                    withCredentials([
                        string(credentialsId: 'SONARQUBE_TOKEN', variable: 'SONAR_TOKEN'),
                        string(credentialsId: 'SONARQUBE_URL', variable: 'SONAR_HOST_URL')
                    ]) {
                        sh """
                            docker run --rm \
                                --memory=2g --memory-swap=2g \
                                -v \$(pwd):/usr/src:ro \
                                -v sonar-scanner-cache:/opt/sonar-scanner/.sonar/cache \
                                -w /usr/src \
                                -e SONAR_HOST_URL=\$SONAR_HOST_URL \
                                -e SONAR_TOKEN=\$SONAR_TOKEN \
                                -e SONAR_SCANNER_JAVA_OPTS='-Xmx768m' \
                                ${SONAR_IMAGE}
                        """
                    }
                    
                    echo 'SonarQube analysis completed - check dashboard for results'
                }
            }
        }
        
        stage('Build Docker Image') {
            options { timeout(time: 20, unit: 'MINUTES') }
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
                        string(credentialsId: 'NODE_ENV', variable: 'NODE_ENV'),
                        string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')
                    ]) {
                        // Login to GHCR for BuildKit cache pull
                        sh 'echo $GITHUB_TOKEN | docker login ghcr.io -u ${GITHUB_USER} --password-stdin'

                        // Seed layer cache from previous image
                        sh "docker pull ${FULL_IMAGE_NAME}:latest || echo 'No previous image available for cache'"

                        sh '''
                            set -e
                            BUILD_SECRETS_FILE=$(mktemp -p /dev/shm build_secrets.XXXXXX.env 2>/dev/null || mktemp build_secrets.XXXXXX.env)
                            chmod 600 "$BUILD_SECRETS_FILE"
                            trap 'rm -f "$BUILD_SECRETS_FILE"' EXIT INT TERM
                            cat <<EOF > "$BUILD_SECRETS_FILE"
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
                            docker build \
                                --memory=3g \
                                --memory-swap=3g \
                                --cache-from '''+FULL_IMAGE_NAME+''':latest \
                                --build-arg BUILDKIT_INLINE_CACHE=1 \
                                --secret id=build_env,src="$BUILD_SECRETS_FILE" \
                                -t '''+DOCKER_IMAGE+''':'''+IMAGE_TAG+''' \
                                -t '''+DOCKER_IMAGE+''':latest \
                                -t '''+FULL_IMAGE_NAME+''':'''+IMAGE_TAG+''' \
                                -t '''+FULL_IMAGE_NAME+''':latest \
                                .
                        '''
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
                    sh """
                        syft file:package-lock.json \
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
                            ${REPORTS_DIR}/sbom-image.cyclonedx.json
                    """
                    
                    // fail on fixable CRITICAL
                    def criticalSource = sh(
                        script: "trivy sbom --severity CRITICAL --ignore-unfixed --exit-code 1 ${REPORTS_DIR}/sbom.cyclonedx.json",
                        returnStatus: true
                    )
                    def criticalImage = sh(
                        script: "trivy sbom --severity CRITICAL --ignore-unfixed --exit-code 1 ${REPORTS_DIR}/sbom-image.cyclonedx.json",
                        returnStatus: true
                    )
                    if (criticalSource != 0 || criticalImage != 0) {
                        error 'Fixable CRITICAL vulnerabilities detected by Trivy - build blocked (see trivy-report.html)'
                    }

                    echo 'Trivy vulnerability scan completed - no fixable CRITICAL findings'
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
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                echo 'Signing Docker image with Cosign...'
                script {
                    withCredentials([
                        file(credentialsId: 'COSIGN_PRIVATE_KEY', variable: 'COSIGN_KEY_FILE'),
                        file(credentialsId: 'COSIGN_PUBLIC_KEY', variable: 'COSIGN_PUB_FILE'),
                        string(credentialsId: 'COSIGN_PASSWORD', variable: 'COSIGN_PASSWORD'),
                        string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')
                    ]) {
                        // Sign by digest with registry credentials
                        sh """
                            export COSIGN_REPOSITORY=${FULL_IMAGE_NAME}
                            cosign login ghcr.io -u ${GITHUB_USER} -p \$GITHUB_TOKEN
                            cosign sign --yes --key \$COSIGN_KEY_FILE ${env.IMAGE_DIGEST}
                        """

                        // Verify signature
                        sh """
                            export COSIGN_REPOSITORY=${FULL_IMAGE_NAME}
                            cosign verify --key \$COSIGN_PUB_FILE ${env.IMAGE_DIGEST}
                        """

                        // Attach SBOM as a signed CycloneDX attestation
                        sh """
                            export COSIGN_REPOSITORY=${FULL_IMAGE_NAME}
                            cosign attest --yes \
                                --key \$COSIGN_KEY_FILE \
                                --type cyclonedx \
                                --predicate ${REPORTS_DIR}/sbom-image.cyclonedx.json \
                                ${env.IMAGE_DIGEST}
                            cosign verify-attestation \
                                --key \$COSIGN_PUB_FILE \
                                --type cyclonedx \
                                ${env.IMAGE_DIGEST} > /dev/null
                        """

                        echo 'Image signed, attested and verified successfully with Cosign'
                    }
                }
            }
        }
        
        stage('SLSA Provenance') {
            options { timeout(time: 5, unit: 'MINUTES') }
            steps {
                echo 'Generating and attaching SLSA provenance attestation...'
                script {
                    withCredentials([
                        file(credentialsId: 'COSIGN_PRIVATE_KEY', variable: 'COSIGN_KEY_FILE'),
                        file(credentialsId: 'COSIGN_PUBLIC_KEY', variable: 'COSIGN_PUB_FILE'),
                        string(credentialsId: 'COSIGN_PASSWORD', variable: 'COSIGN_PASSWORD'),
                        string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')
                    ]) {
                        def buildStartedAt = sh(script: 'date -u +%Y-%m-%dT%H:%M:%SZ', returnStdout: true).trim()
                        def gitFullCommit = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                        def gitRemote = sh(script: 'git config --get remote.origin.url', returnStdout: true).trim()

                        writeFile file: "${REPORTS_DIR}/slsa-provenance.json", text: """{
  \"buildType\": \"https://github.com/slsa-framework/slsa-github-generator/jenkins@v1\",
  \"builder\": { \"id\": \"${env.JENKINS_URL}\" },
  \"invocation\": {
    \"configSource\": {
      \"uri\": \"${gitRemote}\",
      \"digest\": { \"sha1\": \"${gitFullCommit}\" },
      \"entryPoint\": \"Jenkinsfile\"
    },
    \"environment\": {
      \"jenkinsBuildNumber\": \"${env.BUILD_NUMBER}\",
      \"jenkinsJobName\": \"${env.JOB_NAME}\",
      \"jenkinsBuildUrl\": \"${env.BUILD_URL}\"
    }
  },
  \"metadata\": {
    \"buildInvocationId\": \"${env.BUILD_TAG}\",
    \"buildStartedOn\": \"${buildStartedAt}\",
    \"completeness\": { \"parameters\": true, \"environment\": false, \"materials\": true },
    \"reproducible\": false
  },
  \"materials\": [
    { \"uri\": \"git+${gitRemote}@refs/heads/${env.BRANCH_NAME ?: 'main'}\", \"digest\": { \"sha1\": \"${gitFullCommit}\" } }
  ]
}
"""

                        sh """
                            export COSIGN_REPOSITORY=${FULL_IMAGE_NAME}
                            cosign login ghcr.io -u ${GITHUB_USER} -p \$GITHUB_TOKEN
                            cosign attest --yes \
                                --key \$COSIGN_KEY_FILE \
                                --type slsaprovenance \
                                --predicate ${REPORTS_DIR}/slsa-provenance.json \
                                ${env.IMAGE_DIGEST}
                            cosign verify-attestation \
                                --key \$COSIGN_PUB_FILE \
                                --type slsaprovenance \
                                ${env.IMAGE_DIGEST} > /dev/null
                        """
                        echo 'SLSA provenance attached and verified'
                    }
                }
            }
        }
        
        stage('Update K8s Manifest') {
            steps {
                echo 'Updating Kubernetes manifest in config repo...'
                script {
                    withCredentials([string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')]) {
                        sh """
                            rm -rf boostflow-thesis-config
                            git clone https://${GITHUB_USER}:\${GITHUB_TOKEN}@github.com/${GITHUB_USER}/boostflow-thesis-config.git boostflow-thesis-config

                            cd boostflow-thesis-config
                            git config user.email "jenkins@boostflow.me"
                            git config user.name "Jenkins CI"

                            sed -i 's|image: ${FULL_IMAGE_NAME}:.*|image: ${FULL_IMAGE_NAME}:${IMAGE_TAG}|' app-deployment.yaml

                            git add app-deployment.yaml
                            git commit -m "deploy: ${IMAGE_TAG}"
                            git push origin main

                            cd ..
                            rm -rf boostflow-thesis-config
                        """
                    }

                    echo "K8s manifest updated to ${FULL_IMAGE_NAME}:${IMAGE_TAG}"
                    echo 'ArgoCD will detect this change and deploy automatically.'
                }
            }
        }
        
        stage('Wait for Staging Deployment') {
            options { timeout(time: 10, unit: 'MINUTES') }
            steps {
                echo 'Waiting for ArgoCD to sync and staging deployment to be ready...'
                script {
                    def tagMatched = false
                    def runningTag = ''
                    for (int i = 0; i < 36; i++) {
                        runningTag = sh(
                            script: '''kubectl get deployment boostflow-app -n boostflow \
                                -o jsonpath='{.spec.template.spec.containers[0].image}' \
                                | awk -F: '{print $NF}' ''',
                            returnStdout: true
                        ).trim()
                        if (runningTag == env.IMAGE_TAG) {
                            tagMatched = true
                            break
                        }
                        echo "Running tag '${runningTag}' != expected '${env.IMAGE_TAG}'. Waiting for ArgoCD to sync (attempt ${i+1}/36)..."
                        sleep 10
                    }
                    if (!tagMatched) {
                        error "ArgoCD did not sync image tag '${env.IMAGE_TAG}' within 6 minutes (still showing '${runningTag}'). Check ArgoCD application state."
                    }
                    echo "ArgoCD synced to ${env.IMAGE_TAG}"

                    sh """
                        kubectl rollout status deployment/boostflow-app \
                            -n boostflow --timeout=300s
                    """

                    def retries = 30
                    def ready = false
                    for (int i = 0; i < retries; i++) {
                        sh 'echo "Attempting to curl ${STAGING_URL}/api/health..."'
                        def result = sh(
                            script: 'curl -kvf --connect-timeout 10 ${STAGING_URL}/api/health',
                            returnStatus: true
                        )
                        if (result == 0) {
                            ready = true
                            break
                        }
                        sleep 10
                    }

                    if (!ready) {
                        error 'Staging deployment health check failed after 5 minutes'
                    }

                    echo 'Staging deployment is healthy'
                }
            }
        }
        
        stage('Compliance - CIS Benchmark') {
            options { timeout(time: 10, unit: 'MINUTES') }
            steps {
                echo 'Running kube-bench CIS Kubernetes Benchmark...'
                script {
                    withCredentials([string(credentialsId: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN')]) {
                        sh """
                            rm -rf boostflow-thesis-config
                            git clone https://${GITHUB_USER}:\${GITHUB_TOKEN}@github.com/${GITHUB_USER}/boostflow-thesis-config.git boostflow-thesis-config
                        """
                    }

                    def benchStatus = sh(
                        script: '''
                            set -e
                            kubectl -n compliance delete job kube-bench --ignore-not-found
                            kubectl apply -f boostflow-thesis-config/compliance/kube-bench-job.yaml
                            kubectl -n compliance wait --for=condition=complete --timeout=300s job/kube-bench || true
                            kubectl -n compliance logs job/kube-bench --all-containers=true > ''' + "${REPORTS_DIR}/kube-bench.json" + ''' || true
                            kubectl -n compliance get job kube-bench -o yaml > ''' + "${REPORTS_DIR}/kube-bench-job.yaml" + ''' || true
                            kubectl -n compliance get pods -l job-name=kube-bench -o yaml > ''' + "${REPORTS_DIR}/kube-bench-pods.yaml" + ''' || true
                            kubectl -n compliance get events --sort-by=.lastTimestamp > ''' + "${REPORTS_DIR}/kube-bench-events.txt" + ''' || true
                            kubectl -n compliance get job kube-bench -o jsonpath='{.status.succeeded}' | grep -q '^1$'
                        ''',
                        returnStatus: true
                    )

                    sh 'rm -rf boostflow-thesis-config'

                    if (benchStatus != 0) {
                        unstable 'kube-bench job did not complete cleanly (see kube-bench.json)'
                    } else {
                        echo 'kube-bench report archived'
                    }
                }
            }
        }
        
        stage('Trigger DAST Pipeline') {
            steps {
                echo 'Triggering separate DAST pipeline...'
                build job: 'boostflow-dast',
                    wait: false,
                    propagate: false,
                    parameters: [
                        string(name: 'IMAGE_TAG', value: env.IMAGE_TAG),
                        string(name: 'SOURCE_BUILD_URL', value: env.BUILD_URL)
                    ]
            }
        }
    }
    
    post {
        always {
            echo 'Archiving security reports and artifacts...'

            // Publish JUnit test results
            junit testResults: 'coverage/junit.xml', allowEmptyResults: true

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

        unstable {
            echo 'Pipeline is UNSTABLE - quality gates reported non-blocking findings. Review archived reports.'
        }
        
        cleanup {
            // Clean up local Docker images to save space
            sh """
                docker rmi ${DOCKER_IMAGE}:${IMAGE_TAG} || true
                docker rmi ${DOCKER_IMAGE}:latest || true
                docker rmi ${FULL_IMAGE_NAME}:${IMAGE_TAG} || true
                docker rmi ${FULL_IMAGE_NAME}:latest || true
                docker image prune -f
                docker container prune -f
            """
        }
    }
}
