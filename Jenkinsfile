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
        SEMGREP_IMAGE    = 'semgrep/semgrep:1.95.0'
        CHECKOV_IMAGE    = 'bridgecrew/checkov:3.2.256'
        CONFTEST_IMAGE   = 'openpolicyagent/conftest:v0.56.0'
        SONAR_IMAGE      = 'sonarsource/sonar-scanner-cli:11.1'

        // Tool paths
        PATH = "/usr/local/bin:${env.PATH}"
        
        // Report directories
        REPORTS_DIR = 'security-reports'
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

        stage('Resolve Vault Secrets') {
            steps {
                script {
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/staging', engineVersion: 2,
                         secretValues: [[envVar: 'V_STAGING_URL', vaultKey: 'url']]]
                    ]]) {
                        env.STAGING_URL = env.V_STAGING_URL
                    }
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
                    npm ci --audit-level=critical
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
                                --volumes-from jenkins \
                                -w \$(pwd) \
                                ${GITLEAKS_IMAGE} \
                                detect \
                                --source . \
                                --report-format sarif \
                                --report-path ${REPORTS_DIR}/gitleaks-report.sarif \
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
                                --memory=3g --memory-swap=3g \
                                --volumes-from jenkins \
                                -w \$(pwd) \
                                ${SEMGREP_IMAGE} \
                                semgrep scan \
                                --metrics=off \
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
                                --verbose \
                                --sarif-output=${REPORTS_DIR}/semgrep-report.sarif \
                                --json-output=${REPORTS_DIR}/semgrep-report.json \
                                --text-output=${REPORTS_DIR}/semgrep-report.txt \
                                --timeout 300 \
                                --timeout-threshold 15 \
                                --jobs 1 \
                                src/
                        """,
                        returnStatus: true
                    )

                    echo "Semgrep exit code: ${semgrepResult}"
                    sh "ls -la ${REPORTS_DIR}/ || true"
                    archiveArtifacts artifacts: "${REPORTS_DIR}/semgrep-report.*", allowEmptyArchive: true
                    sh "test -f ${REPORTS_DIR}/semgrep-report.txt && (echo '--- Semgrep findings (text) ---'; tail -200 ${REPORTS_DIR}/semgrep-report.txt) || echo 'No semgrep text report produced'"

                    // Exit codes: 0 = clean, 1 = findings, 2+ = error
                    if (semgrepResult == 1) {
                        error "Semgrep found potential security issues (exit=1) - see archived semgrep-report.*"
                    } else if (semgrepResult != 0) {
                        error "Semgrep crashed (exit=${semgrepResult}) - see console output above"
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
                            --volumes-from jenkins \
                            -w \$(pwd) \
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
                                --volumes-from jenkins \\
                                -w \$(pwd) \\
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

                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/github', engineVersion: 2,
                         secretValues: [[envVar: 'GITHUB_TOKEN', vaultKey: 'token']]]
                    ]]) {
                        sh """
                            rm -rf boostflow-thesis-config
                            git clone https://${GITHUB_USER}:\${GITHUB_TOKEN}@github.com/${GITHUB_USER}/boostflow-thesis-config.git boostflow-thesis-config
                        """
                    }

                    def conftestK8s = sh(
                        script: """
                            docker run --rm \\
                                --memory=512m --memory-swap=512m \\
                                --volumes-from jenkins \\
                                -w \$(pwd) \\
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
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/sonarqube', engineVersion: 2, secretValues: [
                            [envVar: 'SONAR_TOKEN',     vaultKey: 'token'],
                            [envVar: 'SONAR_HOST_URL',  vaultKey: 'url']
                        ]]
                    ]]) {
                        sh """
                            set -e
                            # Extract host and port from SONAR_HOST_URL dynamically
                            SONAR_HOST=\$(echo "\$SONAR_HOST_URL" | sed -e 's|^[^/]*//||' -e 's|/.*\$||')
                            case "\$SONAR_HOST" in
                                *:* ) SONAR_CONNECT_ADDR="\$SONAR_HOST" ;;
                                * )   SONAR_CONNECT_ADDR="\${SONAR_HOST}:443" ;;
                            esac

                            echo "Fetching SSL certificate from \$SONAR_CONNECT_ADDR..."
                            echo | openssl s_client -showcerts -connect "\$SONAR_CONNECT_ADDR" 2>/dev/null | openssl x509 -outform PEM > sonar-server.crt

                            echo "Generating temporary PKCS12 truststore..."
                            rm -f sonar-truststore.p12
                            keytool -import -trustcacerts -noprompt -alias sonar-server -file sonar-server.crt -keystore sonar-truststore.p12 -storetype PKCS12 -storepass changeit

                            echo "Running SonarQube scan..."
                            docker run --rm \
                                --memory=2g --memory-swap=2g \
                                --network host \
                                --volumes-from jenkins \
                                -v sonar-scanner-cache:/opt/sonar-scanner/.sonar/cache \
                                -w \$(pwd) \
                                -e SONAR_HOST_URL=\$SONAR_HOST_URL \
                                -e SONAR_TOKEN=\$SONAR_TOKEN \
                                -e SONAR_SCANNER_JAVA_OPTS="-Djavax.net.ssl.trustStore=\$(pwd)/sonar-truststore.p12 -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12 -Xmx768m" \
                                ${SONAR_IMAGE}

                            echo "Cleaning up temporary files..."
                            rm -f sonar-server.crt sonar-truststore.p12
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
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/github', engineVersion: 2, secretValues: [
                            [envVar: 'GITHUB_TOKEN', vaultKey: 'token']
                        ]],
                        [path: 'secret/boostflow/build/firebase-public', engineVersion: 2, secretValues: [
                            [envVar: 'NEXT_PUBLIC_FIREBASE_API_KEY',             vaultKey: 'api_key'],
                            [envVar: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',         vaultKey: 'auth_domain'],
                            [envVar: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',          vaultKey: 'project_id'],
                            [envVar: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',      vaultKey: 'storage_bucket'],
                            [envVar: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', vaultKey: 'messaging_sender_id'],
                            [envVar: 'NEXT_PUBLIC_FIREBASE_APP_ID',              vaultKey: 'app_id'],
                            [envVar: 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID',      vaultKey: 'measurement_id']
                        ]],
                        [path: 'secret/boostflow/build/oauth-public', engineVersion: 2, secretValues: [
                            [envVar: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', vaultKey: 'google_client_id'],
                            [envVar: 'NEXT_PUBLIC_GITHUB_CLIENT_ID', vaultKey: 'github_client_id'],
                            [envVar: 'NEXT_PUBLIC_OAUTH_CLIENT_ID',  vaultKey: 'oauth_client_id']
                        ]],
                        [path: 'secret/boostflow/build/misc', engineVersion: 2, secretValues: [
                            [envVar: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', vaultKey: 'google_maps_api_key'],
                            [envVar: 'NEXT_PUBLIC_APP_URL',             vaultKey: 'app_url'],
                            [envVar: 'NODE_ENV',                        vaultKey: 'node_env']
                        ]],
                        [path: 'secret/boostflow/runtime/firebase-admin', engineVersion: 2, secretValues: [
                            [envVar: 'FIREBASE_SERVICE_ACCOUNT_KEY', vaultKey: 'service_account_key']
                        ]],
                        [path: 'secret/boostflow/runtime/oauth', engineVersion: 2, secretValues: [
                            [envVar: 'GOOGLE_CLIENT_ID',     vaultKey: 'google_client_id'],
                            [envVar: 'GOOGLE_CLIENT_SECRET', vaultKey: 'google_client_secret'],
                            [envVar: 'GITHUB_CLIENT_ID',     vaultKey: 'github_client_id'],
                            [envVar: 'GITHUB_CLIENT_SECRET', vaultKey: 'github_client_secret']
                        ]],
                        [path: 'secret/boostflow/runtime/gemini', engineVersion: 2, secretValues: [
                            [envVar: 'GEMINI_API_KEY', vaultKey: 'api_key']
                        ]],
                        [path: 'secret/boostflow/runtime/minio', engineVersion: 2, secretValues: [
                            [envVar: 'MINIO_ENDPOINT',                vaultKey: 'endpoint'],
                            [envVar: 'MINIO_EXTERNAL_ENDPOINT',       vaultKey: 'external_endpoint'],
                            [envVar: 'MINIO_PORT',                    vaultKey: 'port'],
                            [envVar: 'MINIO_ROOT_USER',               vaultKey: 'root_user'],
                            [envVar: 'MINIO_ROOT_PASSWORD',           vaultKey: 'root_password'],
                            [envVar: 'MINIO_USE_SSL',                 vaultKey: 'use_ssl'],
                            [envVar: 'MINIO_PROFILE_PICTURES_BUCKET', vaultKey: 'profile_pictures_bucket'],
                            [envVar: 'MINIO_PROJECT_DOCUMENTS_BUCKET', vaultKey: 'project_documents_bucket']
                        ]],
                        [path: 'secret/boostflow/runtime/mail', engineVersion: 2, secretValues: [
                            [envVar: 'MAILHOG_HOST',       vaultKey: 'mailhog_host'],
                            [envVar: 'MAILHOG_PORT',       vaultKey: 'mailhog_port'],
                            [envVar: 'DEFAULT_FROM_EMAIL', vaultKey: 'default_from'],
                            [envVar: 'SENDGRID_API_KEY',   vaultKey: 'sendgrid_api_key']
                        ]]
                    ]]) {
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
NEXT_PUBLIC_GITHUB_CLIENT_ID=${NEXT_PUBLIC_GITHUB_CLIENT_ID}
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
                            # Clear BuildKit cache to prevent database corruption
                            docker builder prune -f || true

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
                    // Login to GHCR using GitHub token from Vault
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/github', engineVersion: 2,
                         secretValues: [[envVar: 'GITHUB_TOKEN', vaultKey: 'token']]]
                    ]]) {
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
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/cosign', engineVersion: 2, secretValues: [
                            [envVar: 'COSIGN_KEY',      vaultKey: 'private_key'],
                            [envVar: 'COSIGN_PUB',      vaultKey: 'public_key'],
                            [envVar: 'COSIGN_PASSWORD', vaultKey: 'password']
                        ]],
                        [path: 'secret/boostflow/ci/github', engineVersion: 2, secretValues: [
                            [envVar: 'GITHUB_TOKEN', vaultKey: 'token']
                        ]]
                    ]]) {
                        sh '''
                            set -e
                            export COSIGN_REPOSITORY='''+FULL_IMAGE_NAME+'''
                            cosign login ghcr.io -u '''+GITHUB_USER+''' -p $GITHUB_TOKEN
                            cosign sign --yes --key env://COSIGN_KEY '''+env.IMAGE_DIGEST+'''
                            cosign verify --key env://COSIGN_PUB '''+env.IMAGE_DIGEST+'''
                            cosign attest --yes \
                                --key env://COSIGN_KEY \
                                --type cyclonedx \
                                --predicate '''+REPORTS_DIR+'''/sbom-image.cyclonedx.json \
                                '''+env.IMAGE_DIGEST+'''
                            cosign verify-attestation \
                                --key env://COSIGN_PUB \
                                --type cyclonedx \
                                '''+env.IMAGE_DIGEST+''' > /dev/null
                        '''
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
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/cosign', engineVersion: 2, secretValues: [
                            [envVar: 'COSIGN_KEY',      vaultKey: 'private_key'],
                            [envVar: 'COSIGN_PUB',      vaultKey: 'public_key'],
                            [envVar: 'COSIGN_PASSWORD', vaultKey: 'password']
                        ]],
                        [path: 'secret/boostflow/ci/github', engineVersion: 2, secretValues: [
                            [envVar: 'GITHUB_TOKEN', vaultKey: 'token']
                        ]]
                    ]]) {
                        def buildStartedAt = new Date().format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone("UTC"))
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

                        sh '''
                            set -e
                            export COSIGN_REPOSITORY='''+FULL_IMAGE_NAME+'''
                            cosign login ghcr.io -u '''+GITHUB_USER+''' -p $GITHUB_TOKEN
                            cosign attest --yes \
                                --key env://COSIGN_KEY \
                                --type slsaprovenance \
                                --predicate '''+REPORTS_DIR+'''/slsa-provenance.json \
                                '''+env.IMAGE_DIGEST+'''
                            cosign verify-attestation \
                                --key env://COSIGN_PUB \
                                --type slsaprovenance \
                                '''+env.IMAGE_DIGEST+''' > /dev/null
                        '''
                        echo 'SLSA provenance attached and verified'
                    }
                }
            }
        }
        
        stage('Update K8s Manifest') {
            steps {
                echo 'Updating Kubernetes manifest in config repo...'
                script {
                    withVault([vaultSecrets: [
                        [path: 'secret/boostflow/ci/github', engineVersion: 2,
                         secretValues: [[envVar: 'GITHUB_TOKEN', vaultKey: 'token']]]
                    ]]) {
                        sh """
                            rm -rf boostflow-thesis-config
                            git clone https://${GITHUB_USER}:\${GITHUB_TOKEN}@github.com/${GITHUB_USER}/boostflow-thesis-config.git boostflow-thesis-config

                            cd boostflow-thesis-config
                            git config user.email "jenkins@boostflow-thesis.me"
                            git config user.name "Jenkins CI"

                            sed -i 's|image: ${FULL_IMAGE_NAME}[@:].*|image: ${IMAGE_DIGEST}|' app-deployment.yaml

                            git add app-deployment.yaml
                            git commit -m "deploy: ${IMAGE_TAG} (${IMAGE_DIGEST})"
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
                    def imageMatched = false
                    def runningImage = ''
                    def runningImageId = ''
                    for (int i = 0; i < 36; i++) {
                        runningImage = sh(
                            script: '''kubectl get deployment boostflow-app -n boostflow \
                                -o jsonpath='{.spec.template.spec.containers[0].image}' ''',
                            returnStdout: true
                        ).trim()
                        runningImageId = sh(
                            script: '''kubectl get pods -n boostflow -l app=boostflow-app \
                                -o jsonpath='{.items[0].status.containerStatuses[0].imageID}' 2>/dev/null || true''',
                            returnStdout: true
                        ).trim()
                        if (runningImage == env.IMAGE_DIGEST || runningImageId.endsWith(env.IMAGE_DIGEST.replace("${FULL_IMAGE_NAME}@", "@"))) {
                            imageMatched = true
                            break
                        }
                        echo "Running image '${runningImage}' with imageID '${runningImageId}' != expected '${env.IMAGE_DIGEST}'. Waiting for ArgoCD to sync (attempt ${i+1}/36)..."
                        sleep 10
                    }
                    if (!imageMatched) {
                        error "ArgoCD did not sync image digest '${env.IMAGE_DIGEST}' within 6 minutes (still showing image '${runningImage}' and imageID '${runningImageId}'). Check ArgoCD application state."
                    }
                    echo "ArgoCD synced to ${env.IMAGE_DIGEST}"

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
                echo 'Triggering ArgoCD-managed kube-bench CronJob and collecting report...'
                script {
                    def jobName = "kube-bench-ci-${env.BUILD_NUMBER}"
                    def benchStatus = sh(
                        script: """
                            set -e
                            kubectl -n compliance create job ${jobName} --from=cronjob/kube-bench
                            kubectl -n compliance wait --for=condition=complete --timeout=300s job/${jobName} || true
                            kubectl -n compliance logs job/${jobName} --all-containers=true > ${REPORTS_DIR}/kube-bench.json || true
                            kubectl -n compliance get job ${jobName} -o yaml > ${REPORTS_DIR}/kube-bench-job.yaml || true
                            kubectl -n compliance get pods -l job-name=${jobName} -o yaml > ${REPORTS_DIR}/kube-bench-pods.yaml || true
                            kubectl -n compliance get events --sort-by=.lastTimestamp > ${REPORTS_DIR}/kube-bench-events.txt || true
                            kubectl -n compliance get job ${jobName} -o jsonpath='{.status.succeeded}' | grep -q '^1\$'
                        """,
                        returnStatus: true
                    )

                    sh "kubectl -n compliance delete job ${jobName} --ignore-not-found"

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
            archiveArtifacts artifacts: "${REPORTS_DIR}/*", allowEmptyArchive: true
            
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
            cleanWs()
        }
        success {
            echo 'Pipeline completed successfully!'
            echo "Image available at: ${FULL_IMAGE_NAME}:${IMAGE_TAG}"
            echo "Image available at: ${FULL_IMAGE_NAME}:latest"
            sendHtmlEmail('SUCCESS', 'The BoostFlow pipeline completed successfully.')
        }
        
        failure {
            echo 'Pipeline failed! Check the logs for details.'
            sendHtmlEmail('FAILURE', 'The BoostFlow pipeline FAILED. Immediate action is required to fix the build.')
        }

        unstable {
            echo 'Pipeline is UNSTABLE - quality gates reported non-blocking findings. Review archived reports.'
            sendHtmlEmail('UNSTABLE', 'The BoostFlow pipeline finished, but some security tests (like high vulnerabilities) failed. Please review the security reports immediately.')
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

def sendHtmlEmail(String status, String description) {
    def accentColor = status == 'SUCCESS' ? '#10b981' : (status == 'FAILURE' ? '#ef4444' : '#f59e0b')
    def targetUrl = env.BUILD_URL
    def subject = "${status}: ${env.JOB_NAME} - Build #${env.BUILD_NUMBER}"
    
    def body = """
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; background-color: #0f172a; color: #f8fafc; border-radius: 8px; max-width: 550px; margin: 0 auto; border: 1px solid #334155; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
            <h2 style="color: ${accentColor}; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid ${accentColor}; padding-bottom: 10px;">
                ${status}: ${env.JOB_NAME} - Build #${env.BUILD_NUMBER}
            </h2>
            <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 15px 0;">
                ${description}
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
                <tr style="border-bottom: 1px solid #334155;">
                    <td style="padding: 8px 0; color: #94a3b8; font-weight: 600;">Commit</td>
                    <td style="padding: 8px 0; color: #ffffff; font-family: monospace; font-weight: bold;">${env.GIT_COMMIT_SHORT ?: 'N/A'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #334155;">
                    <td style="padding: 8px 0; color: #94a3b8; font-weight: 600;">Branch</td>
                    <td style="padding: 8px 0; color: #ffffff;">${env.GIT_BRANCH ?: 'main'}</td>
                </tr>
            </table>
            <div style="margin-top: 25px; text-align: center;">
                <a href="${targetUrl}" style="background-color: #3b82f6; border: 1px solid #2563eb; color: #ffffff; padding: 10px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 14px;">
                    View Build
                </a>
            </div>
        </div>
    """
    
    mail to: 'admin@boostflow-thesis.me',
         mimeType: 'text/html',
         subject: subject,
         body: body
}
